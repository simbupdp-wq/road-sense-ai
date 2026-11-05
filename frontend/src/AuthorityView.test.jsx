import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthorityView from './AuthorityView.jsx';
import { analyzeVideo, getAnalysisStatus, getCandidateEvents, getAnnotatedVideoUrl } from './api.js';

vi.mock('./api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, analyzeVideo: vi.fn(), getAnalysisStatus: vi.fn(), getCandidateEvents: vi.fn(), getAnnotatedVideoUrl: vi.fn(() => null) };
});

function selectVideo() {
  fireEvent.change(screen.getByLabelText(/video file/i), {
    target: { files: [new File(['clip'], 'street.mp4', { type: 'video/mp4' })] },
  });
}

describe('Authority workspace', () => {
  it('validates a supported file and submits without a camera ID or device selector', async () => {
    analyzeVideo.mockResolvedValue({ analysis_id: 'analysis-upload', status: 'queued' });
    getAnalysisStatus.mockResolvedValue({ status: 'completed' });
    getCandidateEvents.mockResolvedValue({ analysis_id: 'analysis-upload', events_available: false, events: [], message: null });
    render(<AuthorityView active />);
    selectVideo();
    expect(screen.getByText('street.mp4')).toBeInTheDocument();
    expect(screen.getByText('4 B')).toBeInTheDocument();
    expect(screen.queryByLabelText(/camera id/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/device|gpu/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /analyze video/i }));
    await waitFor(() => expect(analyzeVideo).toHaveBeenCalledWith({ file: expect.any(File) }));
  });

  it('shows the initial empty event and unavailable video states', () => {
    render(<AuthorityView active />);
    expect(screen.getAllByText('No candidate events loaded.').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Annotated video unavailable')).toBeInTheDocument();
  });

  it('loads events from the wrapper and displays actual API fields', async () => {
    analyzeVideo.mockResolvedValue({ analysis_id: 'analysis-events', status: 'queued' });
    getAnalysisStatus.mockResolvedValue({
      status: 'completed',
      result: { annotated_video_url: '/results/analysis-events/annotated.mp4', metadata: { fps: 25, width: 1280, height: 720 } },
    });
    getCandidateEvents.mockResolvedValue({
      analysis_id: 'analysis-events', events_available: true, message: null,
      events: [{
        event_id: 'evt-1', object_ids: [5, 9], classes: ['car', 'pedestrian'], risk: 'HIGH',
        minimum_distance_pixels: 18.5, status: 'candidate_for_human_review', review_status: 'pending',
        start_time_seconds: 3.1, peak_time_seconds: 4.25, end_time_seconds: 5.2,
      }],
    });
    getAnnotatedVideoUrl.mockReturnValue('/results/analysis-events/annotated.mp4');
    render(<AuthorityView active />);
    selectVideo();
    fireEvent.click(screen.getByRole('button', { name: /analyze video/i }));

    expect(await screen.findByText('Candidate near-miss — requires human review')).toBeInTheDocument();
    expect(screen.getAllByText('evt-1').length).toBeGreaterThan(0);
    expect(screen.getByText('5, 9')).toBeInTheDocument();
    expect(screen.getByText('car, pedestrian')).toBeInTheDocument();
    expect(screen.getByText('18.5 px')).toBeInTheDocument();
    expect(screen.getByText('Risk HIGH')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(getCandidateEvents).toHaveBeenCalledWith('analysis-events', expect.any(Object));
  });

  it('seeks to peak_time_seconds when the event is selected after video metadata loads', async () => {
    analyzeVideo.mockResolvedValue({ analysis_id: 'analysis-seek', status: 'queued' });
    getAnalysisStatus.mockResolvedValue({ status: 'completed', result: { metadata: { fps: 30 } } });
    getCandidateEvents.mockResolvedValue({ analysis_id: 'analysis-seek', events_available: true, events: [
      { event_id: 'evt-a', peak_time_seconds: 4.25 },
      { event_id: 'evt-b', peak_frame: 180 },
    ] });
    getAnnotatedVideoUrl.mockReturnValue('/results/analysis-seek/annotated.mp4');
    const { container } = render(<AuthorityView active />);
    selectVideo();
    fireEvent.click(screen.getByRole('button', { name: /analyze video/i }));
    const player = await waitFor(() => container.querySelector('video'));
    Object.defineProperty(player, 'readyState', { configurable: true, value: 1 });
    fireEvent.loadedMetadata(player);
    await waitFor(() => expect(player.currentTime).toBe(4.25));
    fireEvent.click(screen.getByRole('button', { name: /evt-b/i }));
    await waitFor(() => expect(player.currentTime).toBe(6));
  });

  it('filters API pending events and keeps review actions local and single-submit', async () => {
    analyzeVideo.mockResolvedValue({ analysis_id: 'analysis-review', status: 'queued' });
    getAnalysisStatus.mockResolvedValue({ status: 'completed' });
    getCandidateEvents.mockResolvedValue({ analysis_id: 'analysis-review', events_available: true, events: [
      { event_id: 'evt-review', review_status: 'pending', peak_time_seconds: 1.2 },
    ] });
    render(<AuthorityView active />);
    selectVideo();
    fireEvent.click(screen.getByRole('button', { name: /analyze video/i }));
    await screen.findByRole('button', { name: /evt-review/i });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText('Demo only — not saved to the API.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /dismissed · demo/i }));
    expect(screen.getByText('No events match this filter.')).toBeInTheDocument();
  });

  it('shows event loading and API error states, with a retry action', async () => {
    let rejectFirstRequest;
    analyzeVideo.mockResolvedValue({ analysis_id: 'analysis-retry', status: 'queued' });
    getAnalysisStatus.mockResolvedValue({ status: 'completed' });
    getCandidateEvents
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirstRequest = reject; }))
      .mockResolvedValueOnce({ analysis_id: 'analysis-retry', events_available: false, events: [], message: null });
    render(<AuthorityView active />);
    selectVideo();
    fireEvent.click(screen.getByRole('button', { name: /analyze video/i }));
    expect(await screen.findByText('Candidate events are loading…')).toBeInTheDocument();
    await act(async () => rejectFirstRequest(new Error('Events service unavailable.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Events service unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry event request' }));
    await waitFor(() => expect(getCandidateEvents).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('No candidate events were returned.')).length).toBeGreaterThanOrEqual(1);
  });
});
