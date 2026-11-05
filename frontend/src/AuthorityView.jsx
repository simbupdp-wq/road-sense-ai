import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, FileVideo2, RotateCcw, Upload, X } from 'lucide-react';
import { analyzeVideo, getAnalysisStatus, getAnnotatedVideoUrl, getCandidateEvents } from './api.js';
import { monitorAnalysis } from './analysisPolling.js';
import { createDemoReviewAdapter } from './demoReviewAdapter.js';
import { formatFileSize, validateAnalysisUpload } from './uploadValidation.js';
import { formatTime } from './format.js';
import { getEventSeekSeconds } from './timeline.js';

function displayValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.map(String).join(', ');
  return String(value);
}

function hasFiniteNumber(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function eventFields(event) {
  return [
    ['Event ID', displayValue(event.event_id)],
    ['Risk level', displayValue(event.risk)],
    ['Object IDs', displayValue(event.object_ids)],
    ['Classes', displayValue(event.classes)],
    ['Closest distance', hasFiniteNumber(event.minimum_distance_pixels) ? `${event.minimum_distance_pixels} px` : null],
    ['Event status', displayValue(event.status)],
    ['Start time', hasFiniteNumber(event.start_time_seconds) ? formatTime(event.start_time_seconds) : null],
    ['Peak time', hasFiniteNumber(event.peak_time_seconds) ? formatTime(event.peak_time_seconds) : null],
    ['End time', hasFiniteNumber(event.end_time_seconds) ? formatTime(event.end_time_seconds) : null],
    ['API review status', displayValue(event.review_status)],
  ].filter(([, value]) => value !== null);
}

function getStatusFrameRate(statusData) {
  const fps = Number(statusData?.result?.metadata?.fps);
  return Number.isFinite(fps) && fps > 0 ? fps : null;
}

function eventReviewState(event, localReview) {
  if (localReview?.decision === 'confirm') return 'Confirmed · demo';
  if (localReview?.decision === 'dismiss') return 'Dismissed · demo';
  return event.review_status || 'pending';
}

export default function AuthorityView({ active }) {
  const [file, setFile] = useState(null);
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
  const [eventsMessage, setEventsMessage] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [filter, setFilter] = useState('all');
  const [reviewByEvent, setReviewByEvent] = useState({});
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewMessage, setReviewMessage] = useState('');
  const [reviewError, setReviewError] = useState('');
  const [videoError, setVideoError] = useState('');
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
      onEvents: (nextEvents, info = {}) => {
        if (!Array.isArray(nextEvents)) {
          setEventsError('The API did not provide a valid event list.');
          return;
        }
        setEvents(nextEvents);
        setEventsError('');
        setEventsMessage(info.message || '');
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

  const selectedEvent = selectedIndex >= 0 ? events[selectedIndex] : null;
  const selectedKey = selectedEvent?.event_id == null ? null : String(selectedEvent.event_id);
  const selectedReview = selectedKey ? reviewByEvent[selectedKey] : null;
  const frameRate = getStatusFrameRate(statusData);
  const visibleEvents = useMemo(() => events.map((event, index) => ({ event, index })).filter(({ event }) => {
    const local = event.event_id == null ? null : reviewByEvent[String(event.event_id)];
    const state = local?.decision || event.review_status || 'pending';
    if (filter === 'needs-review') return state === 'pending';
    if (filter === 'confirmed') return state === 'confirmed' || state === 'confirm';
    if (filter === 'dismissed') return state === 'dismissed' || state === 'dismiss';
    return true;
  }), [events, filter, reviewByEvent]);
  const videoUrl = getAnnotatedVideoUrl(statusData);
  const serverStatus = statusData?.status;
  const shownStatus = uploading ? 'Uploading' : serverStatus || (analysisId ? 'Waiting for status' : 'No analysis submitted');
  const result = statusData?.result || null;
  const metadata = result?.metadata || {};
  const eventsState = eventsLoading ? 'Candidate events are loading…'
    : eventsError ? 'Candidate events could not be loaded.'
      : events.length ? `${events.length} candidate ${events.length === 1 ? 'event' : 'events'}`
        : serverStatus === 'completed' ? 'No candidate events were returned.' : 'No candidate events loaded.';

  const clearAnalysisData = () => {
    setAnalysisId(null);
    setStatusData(null);
    setEvents([]);
    setEventsError('');
    setEventsMessage('');
    setEventsLoading(false);
    setSelectedIndex(-1);
    setReviewByEvent({});
    setReviewMessage('');
    setReviewError('');
    setPollError('');
    setPollPaused(false);
    setVideoError('');
  };

  const chooseFile = (changeEvent) => {
    const nextFile = changeEvent.target.files?.[0] || null;
    clearAnalysisData();
    setFile(nextFile);
    setUploadError(nextFile ? validateAnalysisUpload(nextFile) || '' : '');
  };

  const submitUpload = async (submitEvent) => {
    submitEvent.preventDefault();
    const validationError = validateAnalysisUpload(file);
    if (validationError) {
      setUploadError(validationError);
      return;
    }
    clearAnalysisData();
    setUploading(true);
    setUploadError('');
    try {
      const accepted = await analyzeVideo({ file });
      setAnalysisId(accepted.analysis_id);
      setStatusData({ analysis_id: accepted.analysis_id, status: accepted.status });
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setUploading(false);
    }
  };

  const reset = () => {
    clearAnalysisData();
    setFile(null);
    setUploadError('');
    setReviewNote('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const selectEvent = (index) => {
    setSelectedIndex(index);
    setReviewMessage('');
    setReviewError('');
    setReviewNote('');
  };

  const recordLocalReview = async (decision) => {
    if (!selectedKey || !selectedEvent || reviewBusy || selectedReview) return;
    setReviewBusy(true);
    setReviewMessage('');
    setReviewError('');
    try {
      const review = await reviewAdapter.current.record({ eventId: selectedKey, decision, note: reviewNote });
      setReviewByEvent((current) => ({ ...current, [selectedKey]: review }));
      setReviewMessage('Demo only — not saved to the API.');
    } catch (error) {
      setReviewError(error.message);
    } finally {
      setReviewBusy(false);
    }
  };

  useEffect(() => {
    const seconds = getEventSeekSeconds(selectedEvent, frameRate);
    const video = videoRef.current;
    if (!video || seconds === null) return undefined;
    const seek = () => { video.currentTime = seconds; };
    if (video.readyState >= 1) seek();
    else video.addEventListener('loadedmetadata', seek, { once: true });
    return () => video.removeEventListener('loadedmetadata', seek);
  }, [selectedEvent, frameRate, videoUrl]);

  return <div className="authority-view" aria-label="Authority workspace">
    <div className="authority-heading">
      <div><p className="eyebrow">AUTHORITY WORKSPACE</p><h1>Review traffic video</h1><p className="section-copy">Upload footage for analysis, then review candidate near-miss events returned by the API.</p></div>
      <span className={`status-chip status-${serverStatus || (uploading ? 'processing' : 'idle')}`}>{shownStatus}</span>
    </div>

    <div className="authority-grid">
      <form className="upload-panel panel" onSubmit={submitUpload} noValidate>
        <div className="panel-heading"><div><p className="eyebrow">NEW ANALYSIS</p><h2>Video upload</h2></div><FileVideo2 size={20} /></div>
        <label className="field-label" htmlFor="roadsense-video">Video file</label>
        <div className="dropzone" onDragOver={(event) => event.preventDefault()} onDrop={(event) => {
          event.preventDefault();
          const nextFile = event.dataTransfer.files?.[0];
          if (nextFile) chooseFile({ target: { files: [nextFile] } });
        }}>
          <Upload size={20} aria-hidden="true" />
          <strong>Drop a video here or browse</strong>
          <span>MP4, MOV, MKV, AVI, or WebM</span>
          <input ref={fileInputRef} id="roadsense-video" className="file-input" type="file" aria-label="Video file"
            accept=".mp4,.mov,.mkv,.avi,.webm,video/mp4,video/quicktime,video/x-matroska,video/x-msvideo,video/webm" onChange={chooseFile} />
        </div>
        {file && <div className="file-summary"><FileVideo2 size={18} /><span><strong>{file.name}</strong><small>{formatFileSize(file.size)}</small></span><button className="icon-button" type="button" aria-label="Remove selected video" onClick={() => { setFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}><X size={16} /></button></div>}
        <p className="field-help">This upload is analyzed for candidate near-miss events that require human review.</p>
        {uploadError && <div className="inline-error" role="alert"><AlertTriangle size={16} /><span>{uploadError}</span></div>}
        <div className="upload-actions">
          <button className="button button-primary" type="submit" disabled={!file || uploading}><Upload size={16} />{uploading ? 'Uploading…' : analysisId ? 'Analyze another video' : 'Analyze video'}</button>
          <button className="button button-quiet" type="button" onClick={reset}><RotateCcw size={15} />Reset</button>
        </div>
        <p className="field-help upload-progress-note">Upload percentage is not shown because this request does not expose byte-level progress.</p>
      </form>

      <section className="analysis-workspace">
        <section className="video-panel panel" aria-label="Annotated video">
          <div className="panel-heading"><div><p className="eyebrow">EVIDENCE PLAYER</p><h2>Annotated video</h2></div>{serverStatus && <span className={`status-chip status-${serverStatus}`}>{serverStatus}</span>}</div>
          {videoUrl ? <>
            <video ref={videoRef} className="authority-video" src={videoUrl} controls preload="metadata" aria-label="Annotated analysis video" onError={() => setVideoError('The API video URL could not be played. Check that the artifact exists and is reachable.')} onLoadedData={() => setVideoError('')} />
            {videoError && <div className="inline-error" role="alert"><AlertTriangle size={16} /><span>{videoError}</span></div>}
          </> : <div className="video-unavailable" role="status"><FileVideo2 size={26} /><strong>Annotated video unavailable</strong><span>The API has not provided result.annotated_video_url. No video artifact is fabricated.</span></div>}
          {selectedEvent && getEventSeekSeconds(selectedEvent, frameRate) === null && <p className="field-help">This event has no peak_time_seconds or usable peak_frame/FPS pair, so the player cannot seek to it.</p>}
        </section>

        <section className="status-panel panel" aria-label="Analysis status and summary">
          <div className="panel-heading"><div><p className="eyebrow">ANALYSIS STATUS</p><h2>{shownStatus}</h2></div><span className={`status-dot status-dot-${serverStatus || (uploading ? 'processing' : 'idle')}`} /></div>
          {analysisId && <p className="analysis-reference">Analysis ID <code>{analysisId}</code></p>}
          {uploading && <p role="status">Sending the selected video. No upload percentage is available.</p>}
          {serverStatus === 'queued' && <p role="status">The API has queued this analysis.</p>}
          {serverStatus === 'processing' && <p role="status">The API reports that this analysis is processing.</p>}
          {serverStatus === 'failed' && <div className="inline-error" role="alert"><AlertTriangle size={16} /><span>{displayValue(statusData?.message) || displayValue(statusData?.error) || 'The analysis failed. Check the API response and retry when ready.'}</span></div>}
          {pollError && <div className="inline-error" role="alert"><AlertTriangle size={16} /><span>{pollError}</span></div>}
          {pollPaused && <button className="button button-secondary" type="button" onClick={() => { setPollError(''); setPollRetry((value) => value + 1); }}>Retry status check</button>}
          {serverStatus === 'completed' && <p role="status">Analysis completed. Candidate events still require human review.</p>}
          <div className="summary-grid" aria-label="Available analysis metadata">
            <div><small>Resolution</small><strong>{hasFiniteNumber(metadata.width) && hasFiniteNumber(metadata.height) ? `${metadata.width} × ${metadata.height}` : 'Unavailable'}</strong></div>
            <div><small>FPS</small><strong>{frameRate ?? 'Unavailable'}</strong></div>
            <div><small>Duration</small><strong>{hasFiniteNumber(metadata.duration_seconds) ? `${metadata.duration_seconds} s` : 'Unavailable'}</strong></div>
            <div><small>Candidate events</small><strong>{serverStatus === 'completed' ? events.length : 'Unavailable'}</strong></div>
          </div>
          {result?.camera_motion_reliability && <p className="field-help">Camera motion: {displayValue(result.camera_motion_reliability)}</p>}
        </section>
      </section>
    </div>

    <section className="candidate-section" aria-label="Candidate events">
      <div className="section-heading"><div><p className="eyebrow">CANDIDATE QUEUE</p><h2>Events for human review</h2></div><span>{eventsState}</span></div>
      <p className="candidate-disclaimer">Every event is a candidate near-miss requiring human review. It is not a confirmed accident or an official incident decision.</p>
      {eventsMessage && <p className="field-help" role="status">{eventsMessage}</p>}
      {eventsError && <div className="inline-error" role="alert"><AlertTriangle size={16} /><span>{eventsError}</span><button type="button" className="text-link" onClick={() => setPollRetry((value) => value + 1)}>Retry event request</button></div>}
      <div className="event-filters" role="group" aria-label="Filter candidate events">
        {[['all', 'All'], ['needs-review', 'Needs review'], ['confirmed', 'Confirmed · demo'], ['dismissed', 'Dismissed · demo']].map(([value, label]) => <button key={value} type="button" className={filter === value ? 'active' : ''} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      {events.length === 0 && !eventsLoading && !eventsError && <div className="empty-candidates" role="status"><strong>{serverStatus === 'completed' ? 'No candidate events were returned.' : 'No candidate events loaded.'}</strong><span>A blank event list does not establish that the footage was risk-free.</span></div>}
      {eventsLoading && <div className="empty-candidates" role="status"><span>Loading candidate events…</span></div>}
      {events.length > 0 && visibleEvents.length === 0 && <div className="empty-candidates" role="status"><strong>No events match this filter.</strong></div>}
      {visibleEvents.length > 0 && <div className="candidate-layout">
        <div className="candidate-list" role="list" aria-label="Candidate event queue">
          {visibleEvents.map(({ event, index }) => {
            const identity = event.event_id == null ? `event-${index}` : String(event.event_id);
            const review = reviewByEvent[identity];
            const selected = selectedIndex === index;
            const timing = getEventSeekSeconds(event, frameRate);
            return <div className="candidate-row-wrap" role="listitem" key={`${identity}-${index}`}>
              <button className={`candidate-row ${selected ? 'selected' : ''}`} type="button" aria-pressed={selected} onClick={() => selectEvent(index)}>
                <span className="candidate-marker" aria-hidden="true" />
                <span className="candidate-row-main"><strong>Candidate near-miss</strong><small>{event.event_id || 'Event ID unavailable'}{timing !== null ? ` · ${formatTime(timing)}` : ''}</small></span>
                <span className={`review-badge ${review?.decision || event.review_status || 'candidate'}`}>{eventReviewState(event, review)}</span>
              </button>
            </div>;
          })}
        </div>

        <article className="event-detail panel" aria-label="Selected event details">
          {selectedEvent ? <>
            <div className="event-detail-header"><div><p className="eyebrow">SELECTED EVENT</p><h3>Candidate near-miss — requires human review</h3></div>
              <span className={`risk-badge risk-${String(selectedEvent.risk || 'unavailable').toLowerCase()}`}>{displayValue(selectedEvent.risk) ? `Risk ${selectedEvent.risk}` : 'Risk unavailable'}</span></div>
            <dl className="event-fields">{eventFields(selectedEvent).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            <div className="review-form">
              <label htmlFor="review-note">Reviewer note (local demo only)</label>
              <textarea id="review-note" value={reviewNote} maxLength={500} onChange={(event) => setReviewNote(event.target.value)} placeholder="Optional note" />
              <div className="review-actions">
                <button className="button button-confirm" type="button" disabled={reviewBusy || Boolean(selectedReview)} onClick={() => recordLocalReview('confirm')}><Check size={16} />Confirm</button>
                <button className="button button-dismiss" type="button" disabled={reviewBusy || Boolean(selectedReview)} onClick={() => recordLocalReview('dismiss')}><X size={16} />Dismiss</button>
              </div>
              <p className="local-only-note">Demo only — not saved to the API. Human review here is not official or legal incident verification.</p>
              {reviewMessage && <p className="feedback-success" role="status">{reviewMessage}</p>}
              {reviewError && <p className="feedback-error" role="alert">{reviewError}</p>}
            </div>
          </> : <div className="empty-candidates"><strong>Select a candidate event.</strong><span>Event fields supplied by the API will appear here.</span></div>}
        </article>
      </div>}
    </section>
  </div>;
}
