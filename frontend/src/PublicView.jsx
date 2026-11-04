import React, { useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, MapPin, RotateCcw } from 'lucide-react';
import RoadMap from './RoadMap.jsx';
import { getConfirmedHotspots } from './api.js';
import { getMapReadyLocations } from './hotspotData.js';
import { getDemoHotspots } from './demo/hotspots.js';
import { makeDemoRouteSuggestion } from './demo/routeSuggestion.js';

function getLocationTitle(location) {
  return location.locationName || location.cameraId || 'Confirmed location';
}

export default function PublicView({ active }) {
  const [source, setSource] = useState('empty');
  const [apiLocations, setApiLocations] = useState([]);
  const [showDemo, setShowDemo] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [viewMode, setViewMode] = useState('map');
  const [selectedId, setSelectedId] = useState(null);

  const locations = useMemo(() => showDemo ? getDemoHotspots() : apiLocations, [showDemo, apiLocations]);
  const mapLocations = useMemo(() => getMapReadyLocations(locations), [locations]);
  const routeSuggestion = useMemo(() => showDemo ? makeDemoRouteSuggestion(locations) : null, [showDemo, locations]);
  const selected = locations.find((location) => location.id === selectedId) || mapLocations[0] || null;

  const checkApi = async () => {
    setChecking(true);
    setError('');
    setShowDemo(false);
    try {
      const response = await getConfirmedHotspots();
      if (!Array.isArray(response)) throw new Error('The hotspot service did not return a list. Confirm its response shape with the API teammate.');
      // The service adapter must map its confirmed-only response to this view model.
      const confirmedOnly = response.filter((location) => location?.reviewStatus === 'confirmed');
      setApiLocations(confirmedOnly);
      setSelectedId(confirmedOnly[0]?.id || null);
      setSource('api');
    } catch (apiError) {
      setError(apiError.message);
      setSource('error');
    } finally {
      setChecking(false);
    }
  };

  const loadDemo = () => {
    setError('');
    setShowDemo(true);
    setSelectedId('demo-location-a');
    setSource('demo');
    setViewMode('map');
  };

  const clearDemo = () => {
    setShowDemo(false);
    setSelectedId(null);
    setSource('empty');
  };

  return <div className="public-view" aria-label="Public View">
    <div className="public-intro">
      <div>
        <p className="eyebrow">PUBLIC INFORMATION</p>
        <h2>Confirmed hotspots</h2>
        <p className="section-copy">Only reviewed, confirmed events belong on this public map. Candidate events are not shown as confirmed hotspots.</p>
      </div>
      {showDemo && <span className="demo-banner" role="status">DEMO DATA · NOT REAL INCIDENTS</span>}
    </div>

    <div className="public-actions">
      <button className="button button-secondary" type="button" onClick={checkApi} disabled={checking}>
        {checking ? 'Checking service…' : <><RotateCcw size={16} />Check hotspot service</>}
      </button>
      {showDemo
        ? <button className="button button-quiet" type="button" onClick={clearDemo}>Hide demo data</button>
        : <button className="button button-primary" type="button" onClick={loadDemo}><MapPin size={16} />Show demo hotspots</button>}
    </div>

    {error && <div className="notice notice-error" role="alert"><AlertTriangle size={17} /><span>{error}</span></div>}
    {source === 'empty' && <div className="notice notice-info" role="status"><MapPin size={17} /><span><strong>No confirmed hotspots are available.</strong> Hotspots API integration is pending.</span></div>}
    {source === 'api' && locations.length === 0 && <div className="notice notice-info" role="status"><MapPin size={17} /><span>No confirmed locations were returned. Candidate records are not included.</span></div>}
    {source === 'demo' && <p className="demo-explanation">These sample points and counts are illustrative. They do not represent real incidents, cameras, or verified locations.</p>}

    <div className="public-workspace">
      <section className="public-map-panel panel" aria-label="Hotspot map and list">
        <div className="panel-heading public-panel-heading">
          <div><h3>{showDemo ? 'Illustrative locations' : 'Location map'}</h3><p>{mapLocations.length} map-ready {mapLocations.length === 1 ? 'location' : 'locations'}</p></div>
          <div className="segmented-control" role="group" aria-label="Hotspot presentation">
            <button type="button" aria-pressed={viewMode === 'map'} onClick={() => setViewMode('map')}>Map</button>
            <button type="button" aria-pressed={viewMode === 'list'} onClick={() => setViewMode('list')}>List</button>
          </div>
        </div>
        {viewMode === 'map' ? <RoadMap
          locations={locations}
          routeCoordinates={routeSuggestion?.coordinates || []}
          routeLabel={routeSuggestion?.label || ''}
          active={active}
          onSelect={(location) => setSelectedId(location.id)}
        /> : <div className="location-list" aria-label="Hotspot locations">
          {!locations.length && <p className="map-empty-copy">No location data is available.</p>}
          {locations.map((location) => <button key={location.id || getLocationTitle(location)} type="button"
            className={`location-row ${selected?.id === location.id ? 'selected' : ''}`}
            onClick={() => setSelectedId(location.id)}>
            <span className="location-pin"><MapPin size={17} /></span>
            <span className="location-copy"><strong>{getLocationTitle(location)}</strong><small>{location.cameraId ? `Camera ${location.cameraId}` : 'Camera ID unavailable'}</small></span>
            <span className="location-count">{Number.isFinite(location.confirmedEventCount) ? `${location.confirmedEventCount} confirmed` : 'Count unavailable'}</span>
          </button>)}
        </div>}
        <div className="map-attribution">Map tiles © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a></div>
      </section>

      <aside className="public-inspector panel" aria-label="Selected location details">
        <div className="inspector-heading"><span className="inspector-mark"><MapPin size={17} /></span><div><p className="eyebrow">LOCATION DETAILS</p><h3>{selected ? getLocationTitle(selected) : 'No location selected'}</h3></div></div>
        {selected ? <>
          <dl className="location-facts">
            <div><dt>Camera</dt><dd>{selected.cameraId || 'Not supplied'}</dd></div>
            <div><dt>Confirmed events</dt><dd>{Number.isFinite(selected.confirmedEventCount) ? selected.confirmedEventCount : 'Not supplied'}</dd></div>
            <div><dt>Coordinates</dt><dd>{Number.isFinite(selected.latitude) && Number.isFinite(selected.longitude) ? `${selected.latitude.toFixed(4)}, ${selected.longitude.toFixed(4)}` : 'Unavailable'}</dd></div>
          </dl>
          {selected.source === 'demo' && <p className="local-only-note">Demo sample only. No incident or camera is verified at this location.</p>}
        </> : <p className="map-empty-copy">Location details will appear when the service returns confirmed coordinates.</p>}
        <div className="route-suggestion">
          <p className="eyebrow">DEMO-ONLY FEATURE</p>
          <h3>Demo Route Suggestion</h3>
          <p>{routeSuggestion?.description || 'A route preview is unavailable until demo locations are loaded.'}</p>
          {routeSuggestion?.locations?.length > 0 ? <ol>{routeSuggestion.locations.map((name, index) => <li key={`${name}-${index}`}><span>{index + 1}</span>{name}{index < routeSuggestion.locations.length - 1 && <ArrowRight size={14} />}</li>)}</ol>
            : <p className="map-empty-copy">Load labeled demo locations to see a simple list preview.</p>}
          <small>This is a visual/list illustration, not navigation, live traffic, route optimization, or a safety recommendation.</small>
        </div>
      </aside>
    </div>
  </div>;
}
