import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, FileVideo2, RotateCcw, Upload, X } from 'lucide-react';
import { analyzeVideo, getAnalysisStatus, getAnnotatedVideoUrl, getCandidateEvents } from './api.js';
import { monitorAnalysis } from './analysisPolling.js';
import { createDemoReviewAdapter } from './demoReviewAdapter.js';
import { formatFileSize, validateAnalysisUpload } from './uploadValidation.js';
import { formatTime } from './format.js';
import { getEventSeekSeconds } from './timeline.js';

const DEMO_CANDIDATE = Object.freeze({
  event_id: 'DEMO-EVENT-01',
  event_type: 'Near-miss candidate',
  timestamp_seconds: 12.4,
  start_frame: 372,
  end_frame: 383,
  track_ids: ['DEMO-TRACK-A', 'DEMO-TRACK-B'],
  classes: ['car', 'pedestrian'],
  description: 'Illustrative candidate record for UI review only.',
  evidence_references: ['frame 372', 'frame 383'],
});

function eventIdentity(event, index) {
  const value = event.event_id ?? event.id;
  return value === null || value === undefined || value === '' ? `list-item-${index}` : String(value);
}

function availableValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}

function getEventFields(event, frameRate) {
  return [
    ['Event ID', availableValue(event.event_id ?? event.id)],
    ['Category', availableValue(event.event_type ?? event.category ?? event.type)],
    ['Timestamp', Number.isFinite(getEventSeekSeconds(event, frameRate)) ? formatTime(getEventSeekSeconds(event, frameRate)) : null],
    ['Frame', availableValue(event.peak_frame ?? event.frame ?? event.start_frame)],
    ['Frame range', event.start_frame !== undefined || event.end_frame !== undefined
      ? `${event.start_frame ?? '—'}–${event.end_frame ?? '—'}` : null],
    ['Track IDs', availableValue(event.track_ids ?? event.actor_ids)],
    ['Classes', availableValue(event.classes ?? event.actor_classes)],
    ['Description', availableValue(event.description ?? event.explanation)],
    ['Evidence', availableValue(event.evidence_references ?? event.evidence_refs)],
  ].filter(([, value]) => value !== null);
}

function getStatusFrameRate(statusData) {
  return statusData?.fps ?? statusData?.frame_rate ?? statusData?.metadata?.fps ?? statusData?.metadata?.frame_rate;
}

export default function AuthorityView({ active }) {
  const [file, setFile] = useState(null);
  const [cameraId, setCameraId] = useState('');
  const [analysisId, setAnalysisId] = useState(null);
  const [statusData, setStatusData] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [pollError, setPollError] = useState('');
  const [pollPaused, setPollPaused] = useState(false);
  const [pollRetry, setPollRetry] = useState(0);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [dataSource, setDataSource] = useState('empty');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [reviewByEvent, setReviewByEvent] = useState({});
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');
  const [reviewError, setReviewError] = useState('');
  const videoRef = useRef(null);
  const fileInputRef = useRef(null);
  const reviewAdapter = useRef(null);
  if (!reviewAdapter.current) reviewAdapter.current = createDemoReviewAdapter();

  useEffect(() => {
    if (!active || !analysisId) return undefined;
    const controller = new AbortController();
    setPollError('');
    setPollPaused(false);
    monitorAnalysis({
      analysisId,
      getStatus: getAnalysisStatus,
      getEvents: getCandidateEvents,
      signal: controller.signal,
      onStatus: (status) => {
        setStatusData(status);
        setUploadError('');
        setPollError('');
      },
      onEventsLoading: setEventsLoading,
      onEvents: (nextEvents) => {
        setEvents(nextEvents);
        setEventsError('');
        setDataSource('api');
        setSelectedEvent(nextEvents[0] || null);
        setSelectedIndex(nextEvents.length ? 0 : -1);
        setReviewNote('');
      },
      onEventsError: (error) => setEventsError(error.message),
      onPollError: (error) => setPollError(error.message),
    }).then((result) => {
      if (!controller.signal.aborted && result?.paused) setPollPaused(true);
    }).catch((error) => {
      if (!controller.signal.aborted) {
        setPollError(error.message);
        setPollPaused(true);
      }
    });
    return () => controller.abort();
  }, [active, analysisId, pollRetry]);

  useEffect(() => {
    const seconds = getEventSeekSeconds(selectedEvent, getStatusFrameRate(statusData));
    const video = videoRef.current;
    if (!video || seconds === null) return undefined;
    const seek = () => { video.currentTime = seconds; };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [selectedEvent, statusData]);

  const selectedKey = selectedEvent ? eventIdentity(selectedEvent, selectedIndex) : null;
  const selectedReview = selectedKey ? reviewByEvent[selectedKey] : null;
  const eventFields = useMemo(() => selectedEvent ? getEventFields(selectedEvent, getStatusFrameRate(statusData)) : [], [selectedEvent, statusData]);
  const videoUrl = getAnnotatedVideoUrl(statusData);
  const serverStatus = statusData?.status;
  const shownStatus = uploading ? 'Uploading' : serverStatus || (analysisId ? 'Waiting for status' : 'No analysis submitted');

  const clearAnalysisData = () => {
    setAnalysisId(null);
    setStatusData(null);
    setEvents([]);
    setEventsError('');
    setEventsLoading(false);
    setSelectedEvent(null);
    setSelectedIndex(-1);
    setReviewByEvent({});
    setReviewMessage('');
    setReviewError('');
    setPollError('');
    setPollPaused(false);
    setDataSource('empty');
  };

  const chooseFile = (changeEvent) => {
    const nextFile = changeEvent.target.files?.[0] || null;
    clearAnalysisData();
    setFile(nextFile);
    setUploadError(nextFile ? validateAnalysisUpload(nextFile, cameraId) || '' : '');
  };

  const submitUpload = async (submitEvent) => {
    submitEvent.preventDefault();
    const validationError = validateAnalysisUpload(file, cameraId);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    clearAnalysisData();
    setDataSource('api');
    setUploading(true);
    setUploadError('');
    try {
      const accepted = await analyzeVideo({ file, cameraId: cameraId.trim() });
      setAnalysisId(accepted.analysis_id);
      setStatusData({ analysis_id: accepted.analysis_id });
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    clearAnalysisData();
    setFile(null);
    setCameraId('');
    setUploadError('');
    setReviewNote('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const loadDemoCandidate = () => {
    clearAnalysisData();
    setEvents([{ ...DEMO_CANDIDATE }]);
    setSelectedEvent({ ...DEMO_CANDIDATE });
    setSelectedIndex(0);
    setDataSource('demo');
    setReviewNote('');
  };

  const selectEvent = (event, index) => {
    setSelectedEvent(event);
    setSelectedIndex(index);
    setReviewMessage('');
    setReviewError('');
    setReviewNote('');
  };

  const recordLocalReview = async (decision) => {
    if (!selectedKey || !selectedEvent || reviewBusy || reviewByEvent[selectedKey]) return;
    setReviewBusy(true);
    setReviewMessage('');
    setReviewError('');
    try {
      const review = await reviewAdapter.current.record({ eventId: selectedKey, decision, note: reviewNote });
      setReviewByEvent((current) => ({ ...current, [selectedKey]: review }));
      setReviewMessage('Demo review — not saved to server.');
    } catch (error) {
      setReviewError(error.message);
    } finally {
      setReviewBusy(false);
    }
  };

  const demoMode = dataSource === 'demo';
  const eventsState = eventsLoading ? 'Candidate events are loading…'
    : eventsError ? 'Candidate events could not be loaded.'
      : events.length ? `${events.length} candidate ${events.length === 1 ? 'event' : 'events'}`
        : dataSource === 'api' && serverStatus === 'completed' ? 'No candidate events were returned.' : 'No candidate events loaded.';

  return <div className="authority-view" aria-label="Authority View">
    <div className="authority-heading">
      <div><p className="eyebrow">AUTHORITY WORKSPACE</p><h2>Review traffic video</h2><p className="section-copy">Upload a clip, track its processing state, and review candidate events returned by the analysis API.</p></div>
      <span className={`status-chip status-${serverStatus || (uploading ? 'processing' : 'idle')}`}>{shownStatus}</span>
    </div>

    {demoMode && <div className="demo-banner" role="status">DEMO CANDIDATE — NO ANALYSIS WAS RUN</div>}
    <div className="authority-grid">
      <form className="upload-panel panel" onSubmit={submitUpload} noValidate>
        <div className="panel-heading"><div><p className="eyebrow">NEW ANALYSIS</p><h3>Video upload</h3></div><FileVideo2 size={20} /></div>
        <label className="field-label" htmlFor="roadsense-video">Video file</label>
        <input ref={fileInputRef} id="roadsense-video" className="file-input" type="file"
          accept=".mp4,.mov,.mkv,.avi,.webm,video/mp4,video/quicktime,video/x-matroska,video/x-msvideo,video/webm"
          onChange={chooseFile} />
        {file ? <div className="file-summary"><FileVideo2 size={18} /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span><button className="icon-button" type="button" aria-label="Remove selected video" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}><X size={16} /></button></div>
          : <p className="field-help">MP4, MOV, MKV, AVI, or WebM. File stays in this browser until the API request is configured and sent.</p>}

        <label className="field-label" htmlFor="roadsense-camera-id">Camera ID</label>
        <input id="roadsense-camera-id" className="text-input" value={cameraId} onChange={(event) => setCameraId(event.target.value)} placeholder="Enter camera ID" autoComplete="off" />
        <p className="field-help">Use the camera identifier assigned by your team.</p>

        <div className="api-contract-note" role="status">
          <AlertTriangle size={16} />
          <span>Upload field names are awaiting the API teammate’s contract. The form won’t send an unconfigured request.</span>
        </div>
        {uploadError && <div className="inline-error" role="alert"><AlertTriangle size={16} /><span>{uploadError}</span></div>}
        <div className="upload-actions">
          <button className="button button-primary" type="submit" disabled={!file || !cameraId.trim() || uploading}>
            <Upload size={16} />{uploading ? 'Uploading…' : analysisId ? 'Retry upload' : 'Analyze video'}
          </button>
          <button className="button button-quiet" type="button" onClick={reset}><RotateCcw size={15} />Reset</button>
        </div>
        <p className="field-help upload-progress-note">Upload percentage is not shown because this browser request does not expose byte-level progress.</p>
        <button className="demo-text-button" type="button" onClick={loadDemoCandidate}>Load demo candidate</button>
      </form>

      <section className="analysis-workspace">
        <section className="video-panel panel" aria-label="Annotated video">
          <div className="panel-heading"><div><p className="eyebrow">EVIDENCE PLAYER</p><h3>Annotated video</h3></div>{serverStatus && <span className={`status-chip status-${serverStatus}`}>{serverStatus}</span>}</div>
          {videoUrl ? <video ref={videoRef} className="authority-video" src={videoUrl} controls preload="metadata" aria-label="Annotated analysis video" />
            : <div className="video-unavailable" role="status"><FileVideo2 size={26} /><strong>Annotated video unavailable</strong><span>The API has not provided a configured video URL. No video artifact is fabricated.</span></div>}
          {selectedEvent && getEventSeekSeconds(selectedEvent) === null && <p className="field-help">This event has no timestamp in seconds, so the player cannot seek to it.</p>}
        </section>

        <section className="status-panel panel" aria-label="Analysis status">
          <div className="panel-heading"><div><p className="eyebrow">ANALYSIS STATUS</p><h3>{shownStatus}</h3></div><span className={`status-dot status-dot-${serverStatus || (uploading ? 'processing' : 'idle')}`} /></div>
          {analysisId && <p className="analysis-reference">Analysis ID <code>{analysisId}</code></p>}
          {uploading && <p role="status">Sending the selected video. No upload percentage is available.</p>}
          {serverStatus === 'queued' && <p role="status">The API has queued this analysis.</p>}
          {serverStatus === 'processing' && <p role="status">The API reports that this analysis is processing.</p>}
          {serverStatus === 'failed' && <div className="inline-error" role="alert"><AlertTriangle size={16} /><span>{availableValue(statusData?.error) || 'The analysis failed. Check the API response and retry when ready.'}</span></div>}
          {pollError && <div className="inline-error" role="alert"><AlertTriangle size={16} /><span>{pollError}</span></div>}
          {pollPaused && <button className="button button-secondary" type="button" onClick={() => { setPollError(''); setPollRetry((value) => value + 1); }}>Retry status check</button>}
          {serverStatus === 'completed' && <p role="status">Analysis completed. Candidate events still require human review.</p>}
        </section>
      </section>
    </div>

    <section className="candidate-section" aria-label="Candidate events">
      <div className="section-heading"><div><p className="eyebrow">CANDIDATE QUEUE</p><h3>Events for human review</h3></div><span>{eventsState}</span></div>
      {eventsError && <div className="inline-error" role="alert"><AlertTriangle size={16} /><span>{eventsError}</span><button type="button" className="text-link" onClick={() => setPollRetry((value) => value + 1)}>Retry event request</button></div>}
      <p className="candidate-disclaimer">Candidates are not confirmed incidents. Review decisions in this UI are local demo decisions, not official or legal verification.</p>
      {demoMode && <p className="demo-inline-label">Demo event data · no server analysis or event response was used.</p>}
      {events.length === 0 && !eventsLoading && !eventsError && <div className="empty-candidates" role="status"><strong>{dataSource === 'api' && serverStatus === 'completed' ? 'No candidate events were returned.' : 'No candidate events loaded.'}</strong><span>Events appear here only when the API returns them or when you explicitly load the labeled UI demo.</span></div>}
      {eventsLoading && <div className="empty-candidates" role="status"><span>Loading candidate events…</span></div>}
      {events.length > 0 && <div className="candidate-layout">
        <div className="candidate-list" role="list" aria-label="Candidate event queue">
          {events.map((event, index) => {
            const identity = eventIdentity(event, index);
            const review = reviewByEvent[identity];
            const selected = selectedKey === identity;
            const label = event.event_type ?? event.category ?? 'Candidate event';
            const timing = getEventSeekSeconds(event);
            return <div className="candidate-row-wrap" role="listitem" key={`${identity}-${index}`}>
              <button className={`candidate-row ${selected ? 'selected' : ''}`} type="button" aria-pressed={selected} onClick={() => selectEvent(event, index)}>
              <span className="candidate-marker" aria-hidden="true" />
              <span className="candidate-row-main"><strong>{label}</strong><small>{event.event_id || event.id || 'Event ID unavailable'}{timing !== null ? ` · ${formatTime(timing)}` : ''}</small></span>
              <span className={`review-badge ${review?.decision || 'candidate'}`}>{review ? `${review.decision === 'confirm' ? 'Confirmed' : 'Dismissed'} (demo)` : 'Candidate'}</span>
              </button>
            </div>;
          })}
        </div>

        <article className="event-detail panel" aria-label="Selected event details">
          {selectedEvent ? <>
            <div className="event-detail-header"><div><p className="eyebrow">SELECTED EVENT</p><h4>{selectedEvent.event_type ?? selectedEvent.category ?? 'Candidate event'}</h4></div>
              <span className={`review-badge ${selectedReview?.decision || 'candidate'}`}>{selectedReview ? `${selectedReview.decision === 'confirm' ? 'Confirmed' : 'Dismissed'} (demo)` : 'Candidate'}</span></div>
            <dl className="event-fields">{eventFields.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            {dataSource === 'api' && <div className="review-form">
              <label htmlFor="review-note">Reviewer note (local demo only)</label>
              <textarea id="review-note" value={reviewNote} maxLength={500} onChange={(event) => setReviewNote(event.target.value)} placeholder="Optional note" />
              <div className="review-actions">
                <button className="button button-confirm" type="button" disabled={reviewBusy || Boolean(selectedReview)} onClick={() => recordLocalReview('confirm')}><Check size={16} />Confirm</button>
                <button className="button button-dismiss" type="button" disabled={reviewBusy || Boolean(selectedReview)} onClick={() => recordLocalReview('dismiss')}><X size={16} />Dismiss</button>
              </div>
              <p className="local-only-note">Demo review — not saved to server.</p>
              {reviewMessage && <p className="feedback-success" role="status">{reviewMessage}</p>}
              {reviewError && <p className="feedback-error" role="alert">{reviewError}</p>}
            </div>}
            {dataSource === 'demo' && <div className="review-form">
              <label htmlFor="review-note-demo">Reviewer note (local demo only)</label>
              <textarea id="review-note-demo" value={reviewNote} maxLength={500} onChange={(event) => setReviewNote(event.target.value)} placeholder="Optional note" />
              <div className="review-actions">
                <button className="button button-confirm" type="button" disabled={reviewBusy || Boolean(selectedReview)} onClick={() => recordLocalReview('confirm')}><Check size={16} />Confirm</button>
                <button className="button button-dismiss" type="button" disabled={reviewBusy || Boolean(selectedReview)} onClick={() => recordLocalReview('dismiss')}><X size={16} />Dismiss</button>
              </div>
              <p className="local-only-note">Demo review — not saved to server.</p>
              {reviewMessage && <p className="feedback-success" role="status">{reviewMessage}</p>}
              {reviewError && <p className="feedback-error" role="alert">{reviewError}</p>}
            </div>}
          </> : <div className="empty-candidates"><strong>Select a candidate event.</strong><span>Available event fields and evidence references will appear here.</span></div>}
        </article>
      </div>}
    </section>
  </div>;
}
