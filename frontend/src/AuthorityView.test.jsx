import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import AuthorityView from './AuthorityView.jsx';
import { analyzeVideo, getAnalysisStatus, getCandidateEvents, getAnnotatedVideoUrl } from './api.js';

vi.mock('./api.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    analyzeVideo: vi.fn(),
    getAnalysisStatus: vi.fn(),
    getCandidateEvents: vi.fn(),
    getAnnotatedVideoUrl: vi.fn(() => null),
  };
});

describe('Authority View', () => {
  it('validates the camera ID and video before any upload request', async () => {
    render(<AuthorityView active />);
    const file = new File(['clip'], 'street.mp4', { type: 'video/mp4' });
    fireEvent.change(screen.getByLabelText(/video file/i), { target: { files: [file] } });
    expect(screen.getByText('street.mp4')).toBeInTheDocument();
    expect(screen.getByText('4 B')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /analyze video/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/camera id/i);
    expect(analyzeVideo).not.toHaveBeenCalled();
  });

  it('keeps review decisions in local demo state and prevents duplicate actions', async () => {
    render(<AuthorityView active />);
    fireEvent.click(screen.getByRole('button', { name: 'Load demo candidate' }));
    expect(screen.getByText(/DEMO CANDIDATE — NO ANALYSIS WAS RUN/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    expect((await screen.findAllByText('Demo review — not saved to server.')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Confirmed (demo)').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
    expect(analyzeVideo).not.toHaveBeenCalled();
  });

  it('shows the initial empty event state and honest missing-video state', () => {
    const view = render(<AuthorityView active />);
    expect(screen.getAllByText('No candidate events loaded.').length).toBeGreaterThanOrEqual(1);
    expect(view.container.querySelector('video')).toBeNull();
  });

  it('shows event loading and error states, then retries the events request', async () => {
    let rejectFirstRequest;
    analyzeVideo.mockResolvedValue({ analysis_id: 'analysis-events' });
    getAnalysisStatus.mockResolvedValue({ status: 'completed' });
    getCandidateEvents
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectFirstRequest = reject; }))
      .mockResolvedValueOnce([]);
    render(<AuthorityView active />);

    fireEvent.change(screen.getByLabelText(/video file/i), {
      target: { files: [new File(['clip'], 'street.mp4', { type: 'video/mp4' })] },
    });
    fireEvent.change(screen.getByLabelText(/camera id/i), { target: { value: 'cam-events' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze video/i }));

    expect(await screen.findByText('Candidate events are loading…')).toBeInTheDocument();
    await act(async () => rejectFirstRequest(new Error('Events service unavailable.')));
    expect(await screen.findByRole('alert')).toHaveTextContent('Events service unavailable.');

    fireEvent.click(screen.getByRole('button', { name: 'Retry event request' }));
    await waitFor(() => expect(getCandidateEvents).toHaveBeenCalledTimes(2));
    expect((await screen.findAllByText('No candidate events were returned.')).length).toBeGreaterThanOrEqual(1);
  });

  it('selects a returned event and seeks by its timestamp or by frame when FPS is supplied', async () => {
    analyzeVideo.mockResolvedValue({ analysis_id: 'analysis-9' });
    getAnalysisStatus.mockResolvedValue({ status: 'completed', fps: 25 });
    getCandidateEvents.mockResolvedValue([
      { event_id: 'evt-seconds', timestamp_seconds: 4.25 },
      { event_id: 'evt-frame', start_frame: 200 },
    ]);
    getAnnotatedVideoUrl.mockReturnValue('/annotated.mp4');
    const { container } = render(<AuthorityView active />);

    fireEvent.change(screen.getByLabelText(/video file/i), {
      target: { files: [new File(['clip'], 'street.mp4', { type: 'video/mp4' })] },
    });
    fireEvent.change(screen.getByLabelText(/camera id/i), { target: { value: 'cam-9' } });
    fireEvent.click(screen.getByRole('button', { name: /analyze video/i }));

    await screen.findByRole('button', { name: /evt-seconds/i });
    const player = container.querySelector('video');
    expect(player).toBeTruthy();
    Object.defineProperty(player, 'readyState', { configurable: true, value: 1 });
    fireEvent.loadedMetadata(player);
    await waitFor(() => expect(player.currentTime).toBe(4.25));
    fireEvent.click(screen.getByRole('button', { name: /evt-seconds/i }));
    await waitFor(() => expect(player.currentTime).toBe(4.25));

    fireEvent.click(screen.getByRole('button', { name: /evt-frame/i }));
    await waitFor(() => expect(player.currentTime).toBe(8));
  });
});
