const { useState, useEffect, useRef } = React;

// Firebase Configuration - UPDATE WITH YOUR FIREBASE CONFIG
const firebaseConfig = {
    apiKey: "AIzaSyC5CBPRE7JNCrkqWHvTOA90N69qKzDeOMI",
    authDomain: "hackrpi2025-fc469.firebaseapp.com",
    projectId: "hackrpi2025-fc469",
    storageBucket: "hackrpi2025-fc469.firebasestorage.app",
    messagingSenderId: "821471832394",
    appId: "1:821471832394:web:3189d03c358e8d9ce8b9b3",
    measurementId: "G-TZMLT04V8D"
};

// Initialize Firebase
if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const database = firebase.database();

function App() {
    const [user, setUser] = useState(null);
    const [authInitializing, setAuthInitializing] = useState(true);
    const [groupCode, setGroupCode] = useState('');
    const [currentGroup, setCurrentGroup] = useState(null);
    const [username, setUsername] = useState('');
    const [sport, setSport] = useState('ski');
    const [groupMembers, setGroupMembers] = useState({});
    const [watchId, setWatchId] = useState(null); // geolocation watch id (if used)
    const [simIntervalId, setSimIntervalId] = useState(null); // simulation interval id
    const [groupName, setGroupName] = useState(''); // name to create
    const [signingIn, setSigningIn] = useState(false); // prevent duplicate sign-in attempts
    const [hasStarted, setHasStarted] = useState(false); // controls initial auth/login screen
    // Derived validation helpers
    const isUsernameValid = (username && username.trim().length >= 2);
    // Maximum acceptable accuracy (in meters). Only GPS-level precision (< 30m) is accepted.
    // WiFi, BLE, and IP-based locations will be rejected to ensure only high-precision
    // GPS locations are stored. This keeps the most recent GPS location unchanged
    // when coarser sources are attempted.
    const MAX_ACCEPTABLE_ACCURACY_METERS = 30; // GPS-only threshold
    const [currentGroupName, setCurrentGroupName] = useState(null); // name after join/create
    const [showLocationPrompt, setShowLocationPrompt] = useState(false);
    const [locationError, setLocationError] = useState('');
    const [showLocationHelp, setShowLocationHelp] = useState(false);
    const [detectedPlatform, setDetectedPlatform] = useState('');
    const [pinMode, setPinMode] = useState(false);
    const [groupPins, setGroupPins] = useState({});
    const [showPinModal, setShowPinModal] = useState(false);
    const [pendingPinLocation, setPendingPinLocation] = useState(null); // { lat, lng }
    const [pinLabel, setPinLabel] = useState(''); // HH:MM format
    const [pinTime, setPinTime] = useState(''); // HH:MM format
    const [selectedTrail, setSelectedTrail] = useState(null); // Store selected trail info
    const [trailsLoading, setTrailsLoading] = useState(false);
    const [showSkiTrails, setShowSkiTrails] = useState(false);
    const [showMtbTrails, setShowMtbTrails] = useState(false);
    const mapInstanceRef = useRef(null);
    const markersRef = useRef({});
    const pinMarkersRef = useRef({});
    const pinModeRef = useRef(false);
    const mapClickHandlerRef = useRef(null);
    const mapRef = useRef(null);
    const skiTrailLayersRef = useRef([]);
    const mtbTrailLayersRef = useRef([]);



    // Helper to get a stable uid (may come from auth.currentUser during async sign-in)
    const getUid = () => {
        return (user && user.uid) || (auth.currentUser && auth.currentUser.uid) || null;
    };

    // Ensure there's an anonymous signed-in user; returns the user object or null
    const ensureSignedIn = async () => {
        if (getUid()) return auth.currentUser || user;
        if (signingIn) return null;
        setSigningIn(true);
        try {
            if (!auth.currentUser) {
                await auth.signInAnonymously();
            }
            // Wait briefly for onAuthStateChanged to fire and set `user`
            await new Promise((resolve) => {
                const unsub = auth.onAuthStateChanged((u) => {
                    unsub();
                    resolve(u || auth.currentUser);
                });
                setTimeout(() => resolve(auth.currentUser), 1000);
            });
            return auth.currentUser;
        } catch (e) {
            console.error('ensureSignedIn failed', e);
            return null;
        } finally {
            setSigningIn(false);
        }
    };

    // Fetch trails from OpenStreetMap Overpass API
    const fetchAndDisplayTrails = async (map, trailType) => {
        if (!map || !trailType) return;
        
        console.log(`[Trails] Fetching ${trailType} trails...`);
        
        // Determine which layers to clear and use
        const layersRef = trailType === 'ski' ? skiTrailLayersRef : mtbTrailLayersRef;
        
        // Clear old trails of this type
        layersRef.current.forEach(layer => {
            try {
                map.removeLayer(layer);
            } catch (e) {
                // Layer might already be removed
            }
        });
        layersRef.current = [];
        
        setTrailsLoading(true);
        
        try {
            const bounds = map.getBounds();
            const south = bounds.getSouth();
            const west = bounds.getWest();
            const north = bounds.getNorth();
            const east = bounds.getEast();
            
            let query;
            
            if (trailType === 'ski') {
                // Query ONLY for ski pistes
                query = `
                    [out:json][timeout:60];
                    (
                      way["piste:type"]["piste:type"!="connection"](${south},${west},${north},${east});
                      relation["piste:type"]["piste:type"!="connection"](${south},${west},${north},${east});
                    );
                    out body;
                    >;
                    out skel qt;
                `;
            } else if (trailType === 'mtb') {
                // Query ONLY for MTB trails
                query = `
                    [out:json][timeout:60];
                    (
                      way["route"="mtb"](${south},${west},${north},${east});
                      way["mtb:scale"](${south},${west},${north},${east});
                      relation["route"="mtb"](${south},${west},${north},${east});
                    );
                    out body;
                    >;
                    out skel qt;
                `;
            } else {
                console.error('[Trails] Invalid trail type:', trailType);
                setTrailsLoading(false);
                return;
            }
            
            console.log('[Trails] Query bounds:', { south, west, north, east });
            
            const response = await fetch('https://overpass-api.de/api/interpreter', {
                method: 'POST',
                body: query,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const data = await response.json();
            const elementCount = data.elements?.length || 0;
            console.log(`[Trails] Received ${elementCount} elements for ${trailType}`);
            
            if (elementCount === 0) {
                console.log(`[Trails] No ${trailType} trails found in this area.`);
                setTrailsLoading(false);
                return;
            }
            
            // Process nodes for coordinates
            const nodes = {};
            data.elements.forEach(el => {
                if (el.type === 'node') {
                    nodes[el.id] = [el.lat, el.lon];
                }
            });
            
            // Process relation members
            const wayMembers = {};
            data.elements.forEach(el => {
                if (el.type === 'relation' && el.members) {
                    el.members.forEach(member => {
                        if (member.type === 'way') {
                            wayMembers[member.ref] = el.tags || {};
                        }
                    });
                }
            });
            
            let trailsDrawn = 0;
            const drawnWays = new Set(); // Prevent duplicates
            
            // Draw trails
            data.elements.forEach(el => {
                if (el.type === 'way' && el.nodes && !drawnWays.has(el.id)) {
                    const coords = el.nodes
                        .map(nodeId => nodes[nodeId])
                        .filter(coord => coord);
                    
                    if (coords.length > 1) {
                        const tags = el.tags || wayMembers[el.id] || {};
                        
                        let color = '#0088cc';
                        let trailTypeName = 'Trail';
                        let width = 4;
                        let isValid = false;
                        
                        if (trailType === 'ski') {
                            // SKI TRAIL
                            const pisteType = tags['piste:type'];
                            if (!pisteType || pisteType === 'connection' || pisteType === 'skitour') {
                                return; // Skip invalid ski trails
                            }
                            
                            isValid = true;
                            trailTypeName = pisteType === 'downhill' ? 'Ski Run' : 
                                           pisteType === 'nordic' ? 'Nordic Trail' : 
                                           'Ski Trail';
                            
                            // Color by difficulty (international standard)
                            const d = (tags['piste:difficulty'] || '').toLowerCase();
                            // Beginner (novice/easy/green) -> Green
                            // Intermediate (intermediate/blue) -> Blue
                            // Advanced/Expert (black) -> Black; Freeride/Extreme -> Orange; Red stays Red.
                            if (['novice','easy','green','green_easy'].includes(d)) {
                                color = '#00c853'; // Green (Beginner)
                            } else if (['intermediate','blue'].includes(d)) {
                                color = '#0066ff'; // Blue (Intermediate)
                            } else if (['advanced','expert','black','black_diamond'].includes(d)) {
                                color = '#000000'; // Black (Advanced/Expert)
                            } else if (['freeride','extreme'].includes(d)) {
                                color = '#ff6600'; // Orange (Freeride/Extreme)
                            } else if (d === 'red') {
                                color = '#ff0000'; // Red (common EU grading)
                            } else {
                                color = '#0088cc'; // Default blue-ish
                            }
                            width = 5;
                        } else if (trailType === 'mtb') {
                            // MTB TRAIL
                            const isMTB = tags['route'] === 'mtb' || tags['mtb:scale'];
                            if (!isMTB) {
                                return; // Skip if not MTB trail
                            }
                            
                            isValid = true;
                            trailTypeName = 'MTB Trail';
                            const mtbScale = tags['mtb:scale'];
                            
                            // Color by MTB difficulty scale (0-6+)
                            if (mtbScale === '0' || mtbScale === '0+') {
                                color = '#00ff00'; // Green - easy
                            } else if (mtbScale === '1' || mtbScale === '1+') {
                                color = '#0066ff'; // Blue - moderate
                            } else if (mtbScale === '2' || mtbScale === '2+') {
                                color = '#ff8800'; // Orange - difficult
                            } else if (mtbScale === '3' || mtbScale === '3+') {
                                color = '#ff0000'; // Red - very difficult
                            } else if (mtbScale === '4' || mtbScale === '4+' || mtbScale === '5' || mtbScale === '6') {
                                color = '#000000'; // Black - extremely difficult
                            } else {
                                color = '#ff8800'; // Default orange for MTB
                            }
                            width = 4;
                        }
                        
                        if (!isValid) return;
                        
                        const polyline = L.polyline(coords, {
                            color: color,
                            weight: width,
                            opacity: 0.8,
                            smoothFactor: 1
                        }).addTo(map);
                        
                        drawnWays.add(el.id);
                        trailsDrawn++;
                        
                        // Create popup with trail info
                        const name = tags.name || tags.ref || 'Unnamed Trail';
                        const difficulty = tags['piste:difficulty'] || tags['mtb:scale'] || 'Unknown';
                        const description = tags.description || '';
                        
                        let popupContent = `
                            <div style="min-width: 200px;">
                                <strong style="font-size: 16px; color: ${color};">${name}</strong><br>
                                <em>${trailTypeName}</em><br>
                                <strong>Difficulty:</strong> ${difficulty}<br>
                        `;
                        
                        if (description) {
                            popupContent += `<strong>Info:</strong> ${description}<br>`;
                        }
                        
                        if (tags['piste:grooming']) {
                            popupContent += `<strong>Grooming:</strong> ${tags['piste:grooming']}<br>`;
                        }
                        
                        if (tags.surface) {
                            popupContent += `<strong>Surface:</strong> ${tags.surface}<br>`;
                        }
                        
                        if (tags.ref) {
                            popupContent += `<strong>Ref:</strong> ${tags.ref}<br>`;
                        }
                        
                        if (tags['mtb:scale:uphill']) {
                            popupContent += `<strong>Uphill Scale:</strong> ${tags['mtb:scale:uphill']}<br>`;
                        }
                        
                        popupContent += `</div>`;
                        
                        polyline.bindPopup(popupContent);
                        
                        // Store trail info when clicked
                        const trailInfo = {
                            name: name,
                            type: trailTypeName,
                            difficulty: difficulty,
                            color: color,
                            description: description,
                            location: coords[Math.floor(coords.length / 2)] // Middle point of trail
                        };
                        
                        polyline.on('click', function(e) {
                            console.log('[Trail] Trail clicked:', trailInfo.name);
                            setSelectedTrail(trailInfo);
                        });
                        
                        // Store trail layer for cleanup
                        layersRef.current.push(polyline);
                        
                        // Highlight on hover
                        polyline.on('mouseover', function() {
                            this.setStyle({ weight: width + 3, opacity: 1 });
                        });
                        polyline.on('mouseout', function() {
                            this.setStyle({ weight: width, opacity: 0.8 });
                        });
                    }
                }
            });
            
            console.log(`[Trails] Successfully drew ${trailsDrawn} ${trailType} trails on the map`);
            
            if (trailsDrawn === 0) {
                console.log(`[Trails] Warning: Found elements but no valid ${trailType} trails to display.`);
            }
        } catch (error) {
            console.error(`[Trails] Error fetching ${trailType} trail data:`, error);
        } finally {
            setTrailsLoading(false);
        }
    };

    // Centralized map initialization to avoid race conditions
    const initMapIfNeeded = () => {
        if (!currentGroup) return;
        if (!mapRef.current) return; // DOM not attached yet
        if (mapInstanceRef.current) return; // Already initialized
        try {
            console.log('[Map] Initializing map for group', currentGroup);
            const map = L.map(mapRef.current).setView([42.7285, -73.6852], 13);
            
            // Base layer - Outdoor/Topographic map
            L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap',
                maxZoom: 17
            }).addTo(map);
            
            // Layer control to toggle between base maps only
            const baseLayers = {
                'Topographic': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap contributors, SRTM | © OpenTopoMap',
                    maxZoom: 17
                }).addTo(map),
                'Standard': L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap contributors',
                    maxZoom: 18
                })
            };
            
            L.control.layers(baseLayers, {}).addTo(map);
            
            // Don't auto-load trails - let user toggle them with buttons
            
            mapInstanceRef.current = map;
            // Multiple delayed invalidations to handle flex layout settling
            [50, 250, 1000].forEach(delay => {
                setTimeout(() => {
                    if (mapInstanceRef.current) {
                        mapInstanceRef.current.invalidateSize();
                        console.log('[Map] invalidateSize at', delay, 'ms');
                    }
                }, delay);
            });
        } catch (e) {
            console.error('[Map] Initialization failed:', e);
        }
    };

    // Remove entire group if no members remain
    const cleanupGroupIfEmpty = async (code) => {
        if (!code) return;
        try {
            const membersSnap = await database.ref(`groups/${code}/members`).once('value');
            if (!membersSnap.exists()) {
                console.log('[Cleanup] Removing empty group', code);
                await database.ref(`groups/${code}`).remove();
            }
        } catch (e) {
            console.warn('[Cleanup] Failed to check/remove group', code, e);
        }
    };

    // Generate a unique group code
    const generateGroupCode = async (length = 6, attempts = 10) => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        for (let i = 0; i < attempts; i++) {
            let code = '';
            for (let j = 0; j < length; j++) {
                code += chars[Math.floor(Math.random() * chars.length)];
            }
            // Check if group already exists
            const snap = await database.ref(`groups/${code}`).once('value');
            if (!snap.exists()) return code;
        }
        throw new Error('Failed to generate unique group code. Please try again.');
    };

    // Authentication state listener
    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            console.log('[Auth] State changed. User:', !!user, 'Username:', username);
            // Don't forcibly sign out anonymous users; just update state.
            setUser(user);
            setAuthInitializing(false);
        });
        return () => unsubscribe();
    }, []);

    // Initialize map when group changes
    useEffect(() => {
        initMapIfNeeded();
    }, [currentGroup]);

    // Update pinMode ref and attach/detach click handler
    useEffect(() => {
        pinModeRef.current = pinMode;
        
        if (!mapInstanceRef.current) return;
        
        // Remove old handler if exists
        if (mapClickHandlerRef.current) {
            mapInstanceRef.current.off('click', mapClickHandlerRef.current);
        }
        
        // Add new handler that works for pin mode
        const handler = (e) => {
            if (pinModeRef.current) {
                // Pin mode
                setPendingPinLocation({ lat: e.latlng.lat, lng: e.latlng.lng });
                setPinLabel('');
                const now = new Date();
                const hours = String(now.getHours()).padStart(2, '0');
                const minutes = String(now.getMinutes()).padStart(2, '0');
                setPinTime(`${hours}:${minutes}`);
                setShowPinModal(true);
            }
        };
        
        mapClickHandlerRef.current = handler;
        mapInstanceRef.current.on('click', handler);
        
        return () => {
            if (mapInstanceRef.current && mapClickHandlerRef.current) {
                mapInstanceRef.current.off('click', mapClickHandlerRef.current);
            }
        };
    }, [pinMode, currentGroup, username]);

    // Invalidate size on window resize
    useEffect(() => {
        const handleResize = () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.invalidateSize();
                console.log('[Map] invalidateSize on resize');
            }
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    // Detect platform to tailor location help
    useEffect(() => {
        const ua = (navigator.userAgent || '').toLowerCase();
        let platform = 'other';
        if (/iphone|ipad|ipod/.test(ua)) platform = 'ios';
        else if (/android/.test(ua)) platform = 'android';
        else if (/safari/.test(ua) && !/chrome|crios|android/.test(ua)) platform = 'safari';
        else if (/edg\//.test(ua)) platform = 'edge';
        else if (/chrome|crios/.test(ua)) platform = 'chrome';
        setDetectedPlatform(platform);
    }, []);

    // Fallback cleanup on browser/tab close
    useEffect(() => {
        if (!currentGroup || !user) return;
        const handleBeforeUnload = () => {
            try {
                // Attempt immediate removals; onDisconnect already queued
                const uid = getUid();
                if (uid) {
                    database.ref(`groups/${currentGroup}/locations/${uid}`).remove();
                    database.ref(`groups/${currentGroup}/members/${uid}`).remove();
                }
            } catch (e) {
                console.warn('[Unload] Failed immediate removal', e);
            }
        };
        window.addEventListener('beforeunload', handleBeforeUnload);
        return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [currentGroup, user]);

    // Listen to group location updates
    useEffect(() => {
        if (!currentGroup) return;

        const locationsRef = database.ref(`groups/${currentGroup}/locations`);
        
        locationsRef.on('value', (snapshot) => {
            const locations = snapshot.val() || {};
            setGroupMembers(locations);
            
            // Update markers on map
            if (mapInstanceRef.current) {
                // Clear old markers
                Object.values(markersRef.current).forEach(marker => marker.remove());
                markersRef.current = {};
                
                // Add new markers
                Object.entries(locations).forEach(([userId, data]) => {
                    if (data.lat && data.lon) {
                        // Generate a unique color for each user based on their ID
                        const hue = (parseInt(userId.charCodeAt(0)) * 137.5) % 360; // Use golden angle for color distribution
                        const userColor = `hsl(${hue}, 70%, 50%)`;
                        const icon = L.divIcon({
                            className: 'custom-marker',
                            html: `<div class="marker-user" style="--marker-color: ${userColor}">
                                      <div class="marker-label">${data.name}</div>
                                   </div>`,
                            iconSize: [44, 56],
                            iconAnchor: [22, 56],
                            popupAnchor: [0, -56]
                        });
                        
                        const marker = L.marker([data.lat, data.lon], { icon })
                            .addTo(mapInstanceRef.current);
                        
                        marker.bindPopup(`
                            <strong>${data.name}</strong><br>
                            Sport: ${data.sport}<br>
                            Last update: ${new Date(data.timestamp).toLocaleTimeString()}
                        `);
                        
                        markersRef.current[userId] = marker;
                    }
                });
            }
        });

        return () => locationsRef.off();
    }, [currentGroup]);

    // Listen to group pins
    useEffect(() => {
        if (!currentGroup) return;

        const pinsRef = database.ref(`groups/${currentGroup}/pins`);
        
        pinsRef.on('value', (snapshot) => {
            const pins = snapshot.val() || {};
            setGroupPins(pins);
            
            // Check for expired pins and delete them
            const now = Date.now();
            Object.entries(pins).forEach(([pinId, data]) => {
                if (data.createdAt && data.expiresAt && now > data.expiresAt) {
                    database.ref(`groups/${currentGroup}/pins/${pinId}`).remove();
                }
            });
            
            // Update pin markers on map
            if (mapInstanceRef.current) {
                // Clear old pin markers
                Object.values(pinMarkersRef.current).forEach(marker => marker.remove());
                pinMarkersRef.current = {};
                
                // Add new pin markers
                Object.entries(pins).forEach(([pinId, data]) => {
                    if (data.lat && data.lon) {
                        const pinIcon = L.divIcon({
                            className: 'pin-marker-container',
                            html: `<div class="pin-marker-wrapper">
                                      <div class="pin-label">${data.label}${data.pinTime ? ' @ ' + data.pinTime : ''}</div>
                                      <svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40" class="pin-icon" style="display: block;">
                                        <path fill="#e74c3c" stroke="#c0392b" stroke-width="2" d="M16 0C9.4 0 4 5.4 4 12c0 8 12 28 12 28s12-20 12-28c0-6.6-5.4-12-12-12z"/>
                                        <circle cx="16" cy="12" r="6" fill="white"/>
                                      </svg>
                                   </div>`,
                            iconSize: [80, 70],
                            iconAnchor: [40, 65],
                            popupAnchor: [0, -70]
                        });
                        
                        const marker = L.marker([data.lat, data.lon], { icon: pinIcon })
                            .addTo(mapInstanceRef.current);
                        
                        let popupContent = `
                            <div style="min-width: 200px;">
                                <strong style="font-size: 16px;">${data.label}</strong><br>
                        `;
                        
                        // Add trail information if this is a trail pin
                        if (data.trail) {
                            popupContent += `
                                <div style="background: #f0f0f0; padding: 8px; border-radius: 6px; margin: 8px 0; border-left: 4px solid ${data.trail.color};">
                                    <strong style="color: ${data.trail.color};">🎿 ${data.trail.type}</strong><br>
                                    <em>Trail: ${data.trail.name}</em><br>
                                    <strong>Difficulty:</strong> ${data.trail.difficulty}
                                </div>
                            `;
                        }
                        
                        popupContent += `
                                <strong>Time:</strong> ${data.pinTime || 'N/A'}<br>
                                <strong>By:</strong> ${data.createdBy}<br>
                                <strong>Created:</strong> ${new Date(data.createdAt).toLocaleTimeString()}<br>
                                <strong>Expires:</strong> ${new Date(data.expiresAt).toLocaleTimeString()}<br>
                                <button onclick="if(confirm('Delete this pin?')) { firebase.database().ref('groups/${currentGroup}/pins/${pinId}').remove(); }" style="margin-top:8px;padding:4px 8px;background:#e74c3c;color:white;border:none;border-radius:4px;cursor:pointer;">Delete Pin</button>
                            </div>
                        `;
                        
                        marker.bindPopup(popupContent);
                        
                        pinMarkersRef.current[pinId] = marker;
                    }
                });
            }
        });

        return () => pinsRef.off();
    }, [currentGroup, username]);

    // Periodic check for expired pins
    useEffect(() => {
        if (!currentGroup) return;

        const checkExpiredPins = () => {
            const now = Date.now();
            Object.entries(groupPins).forEach(([pinId, data]) => {
                if (data.expiresAt && now > data.expiresAt) {
                    database.ref(`groups/${currentGroup}/pins/${pinId}`).remove().catch(e => 
                        console.log('Pin already deleted or error removing:', e)
                    );
                }
            });
        };

        // Check every 30 seconds for expired pins
        const interval = setInterval(checkExpiredPins, 30000);
        return () => clearInterval(interval);
    }, [currentGroup, groupPins]);

    // Start location tracking when group is joined
    useEffect(() => {
        if (currentGroup && user && !watchId) {
            console.log('Group joined, starting location tracking for group:', currentGroup);
            startLocationTracking();
        }
    }, [currentGroup, user, watchId]);

    // Start location tracking
    const startLocationTracking = () => {
        console.log('Starting location tracking...');
        console.log('User:', user?.uid, 'Group:', currentGroup, 'Username:', username);
        
        if (!navigator.geolocation) {
            console.log('Geolocation not supported, prompting user');
            setLocationError('Your browser does not support location or it is disabled.');
            setShowLocationPrompt(true);
            return;
        }

        // Try to get real location first
        const id = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude, accuracy } = position.coords;
                
                // Only accept high-precision GPS fixes. Ignore any update that
                // does not meet the GPS accuracy threshold. This prevents coarse
                // WiFi/IP fixes from overwriting a true GPS location and also
                // avoids saving coarse locations at all.
                const isGpsQuality = (typeof accuracy === 'number' && accuracy < MAX_ACCEPTABLE_ACCURACY_METERS);
                if (!isGpsQuality) {
                    console.warn(`Ignoring non-GPS-quality location update (accuracy=${accuracy}m). Waiting for a precise GPS fix.`);
                    return;
                }

                const uid = getUid();
                if (uid && currentGroup) {
                    database.ref(`groups/${currentGroup}/locations/${uid}`).set({
                        name: username,
                        sport: sport,
                        lat: latitude,
                        lon: longitude,
                        timestamp: Date.now()
                    }).then(() => {
                        console.log(`✅ Location saved to Firebase`);
                    }).catch((err) => {
                        console.error('❌ Error saving to Firebase:', err);
                    });

                    if (mapInstanceRef.current) {
                        mapInstanceRef.current.flyTo([latitude, longitude], 15, {
                            animate: true,
                            duration: 1.5
                        });
                    }
                }
            },
            (error) => {
                console.error('Error getting real location:', error);
                let msg = 'Unable to access your location.';
                if (error.code === 1) msg = 'Permission denied. Please allow location access in your browser settings.';
                else if (error.code === 2) msg = 'Position unavailable. Please check your GPS/Location services.';
                else if (error.code === 3) msg = 'Location request timed out. Please try again.';
                setLocationError(msg);
                setShowLocationPrompt(true);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 10000,
                timeout: 10000
            }
        );

        setWatchId(id);
    };

    // Use simulated location as fallback (not used by default; kept for demos)
    const useSimulatedLocation = () => {
        const updateSimulatedLocation = () => {
            const simulatedLat = 50.1163 + (Math.random() - 0.5) * 0.01;
            const simulatedLon = -122.9574 + (Math.random() - 0.5) * 0.01;
            
            console.log('Updating simulated location:', simulatedLat, simulatedLon);
            
            const uid = getUid();
            if (uid && currentGroup) {
                database.ref(`groups/${currentGroup}/locations/${uid}`).set({
                    name: username,
                    sport: sport,
                    lat: simulatedLat,
                    lon: simulatedLon,
                    timestamp: Date.now()
                }).then(() => {
                    console.log('✅ Simulated location saved to Firebase!');
                }).catch((err) => {
                    console.error('❌ Error saving to Firebase:', err);
                });

                if (mapInstanceRef.current) {
                    mapInstanceRef.current.flyTo([simulatedLat, simulatedLon], 15, {
                        animate: true,
                        duration: 1.5
                    });
                }
            }
        };
        
        // Clear any existing simulation interval before starting a new one
        if (simIntervalId) {
            clearInterval(simIntervalId);
            setSimIntervalId(null);
        }

        // Initial update
        updateSimulatedLocation();
        
        // Update every 5 seconds
        const simulationInterval = setInterval(updateSimulatedLocation, 5000);
        setSimIntervalId(simulationInterval);
        
        console.log('✅ Simulated location tracking started!');
    };

    // Stop location tracking
    const stopLocationTracking = () => {
        // Stop simulated interval if active
        if (simIntervalId) {
            clearInterval(simIntervalId);
            setSimIntervalId(null);
        }
        // Stop geolocation watcher if active (legacy path)
        if (watchId) {
            try {
                navigator.geolocation.clearWatch(watchId);
            } catch (e) {
                // ignore if not a geolocation id
            }
            setWatchId(null);
        }
    };

    // Anonymous sign in
    const handleSignIn = async () => {
        console.log('[Sign In] Attempting sign in. Username:', username, 'Length:', username.trim().length);
        
        // Strict validation
        if (!username.trim() || username.trim().length < 2) {
            console.log('[Sign In] Rejected - username too short');
            alert('Please enter a name with at least 2 characters');
            return;
        }
        
        if (signingIn) {
            console.log('[Sign In] Already signing in, blocking duplicate attempt');
            return;
        }
        
        setSigningIn(true);
        console.log('[Sign In] Starting authentication...');
        
        try {
            // Only sign in if not already signed in
            if (!auth.currentUser) {
                await auth.signInAnonymously();
                console.log('[Sign In] ✅ Successfully authenticated');
            } else {
                console.log('[Sign In] User already authenticated');
            }
            // Only set hasStarted after successful authentication
            setHasStarted(true);
        } catch (error) {
            console.error('[Sign In] ❌ Error signing in:', error);
            alert('Error signing in: ' + error.message);
            setSigningIn(false);
        }
    };

    // Join group
    const handleJoinGroup = async () => {
        if (!groupCode.trim()) {
            alert('Please enter a group code');
            return;
        }
        // Ensure we have an authenticated user
        const signed = await ensureSignedIn();
        if (!signed || !signed.uid) {
            alert('Unable to sign in. Please try again.');
            return;
        }
        const uid = signed.uid;

        const code = groupCode.toUpperCase();
        setCurrentGroup(code);
        // Fetch meta name if exists
        try {
            const metaSnap = await database.ref(`groups/${code}/meta/name`).once('value');
            if (metaSnap.exists()) {
                setCurrentGroupName(metaSnap.val());
            } else {
                setCurrentGroupName(null);
            }
        } catch (e) {
            console.warn('Could not load group name:', e);
        }
        
        // Add user to group members
        await database.ref(`groups/${code}/members/${uid}`).set({
            name: username,
            sport: sport,
            joinedAt: Date.now()
        });

        // Presence cleanup on disconnect
        database.ref(`groups/${code}/members/${uid}`).onDisconnect().remove();
        database.ref(`groups/${code}/locations/${uid}`).onDisconnect().remove();
    };

    // Leave group
    const handleLeaveGroup = async () => {
        stopLocationTracking();
        
        const uid = getUid();
        if (uid && currentGroup) {
            try {
                await database.ref(`groups/${currentGroup}/locations/${uid}`).remove();
                await database.ref(`groups/${currentGroup}/members/${uid}`).remove();
                // After leaving, attempt cleanup
                cleanupGroupIfEmpty(currentGroup);
            } catch (e) {
                console.warn('Error removing presence on leave:', e);
            }
        }

        // Clean up map instance
        if (mapInstanceRef.current) {
            try {
                mapInstanceRef.current.remove();
            } catch (e) {
                console.warn('Map remove failed', e);
            }
            mapInstanceRef.current = null;
        }
        markersRef.current = {};
        pinMarkersRef.current = {};
        
        setCurrentGroup(null);
        setGroupCode('');
        setCurrentGroupName(null);
    };

    // Sign out
    const handleSignOut = async () => {
        stopLocationTracking();
        handleLeaveGroup();
        await auth.signOut();
        
        // Reset everything that affects login flow
        setUsername('');
        setHasStarted(false);
        setSigningIn(false);
        setUser(null);
        setCurrentGroup(null);
        setGroupCode('');
        setCurrentGroupName(null);
    };

    // Toggle ski trails
    const toggleSkiTrails = () => {
        if (!mapInstanceRef.current) return;
        
        if (showSkiTrails) {
            // Hide ski trails
            console.log('[Trails] Hiding ski trails');
            skiTrailLayersRef.current.forEach(layer => {
                try {
                    mapInstanceRef.current.removeLayer(layer);
                } catch (e) {
                    console.warn('Error removing ski trail layer:', e);
                }
            });
            skiTrailLayersRef.current = [];
            setShowSkiTrails(false);
        } else {
            // Show ski trails
            console.log('[Trails] Showing ski trails');
            setShowSkiTrails(true);
            fetchAndDisplayTrails(mapInstanceRef.current, 'ski');
        }
    };

    // Toggle MTB trails
    const toggleMtbTrails = () => {
        if (!mapInstanceRef.current) return;
        
        if (showMtbTrails) {
            // Hide MTB trails
            console.log('[Trails] Hiding MTB trails');
            mtbTrailLayersRef.current.forEach(layer => {
                try {
                    mapInstanceRef.current.removeLayer(layer);
                } catch (e) {
                    console.warn('Error removing MTB trail layer:', e);
                }
            });
            mtbTrailLayersRef.current = [];
            setShowMtbTrails(false);
        } else {
            // Show MTB trails
            console.log('[Trails] Showing MTB trails');
            setShowMtbTrails(true);
            fetchAndDisplayTrails(mapInstanceRef.current, 'mtb');
        }
    };

    // Create new group with generated code
    const handleCreateGroup = async () => {
        if (!username.trim()) {
            alert('Enter your name first');
            return;
        }
        // Ensure signed-in
        const signed = await ensureSignedIn();
        if (!signed || !signed.uid) {
            alert('Unable to sign in. Please try again.');
            return;
        }
        const uid = signed.uid;

        try {
            let codeInput = groupCode.trim().toUpperCase();
            const codePattern = /^[A-Z0-9]{4,8}$/; // allow 4-8 chars alphanumeric
            let finalCode;
            if (codeInput) {
                if (!codePattern.test(codeInput)) {
                    alert('Custom code must be 4-8 letters/numbers (A-Z, 0-9).');
                    return;
                }
                // Check uniqueness
                const exists = (await database.ref(`groups/${codeInput}`).once('value')).exists();
                if (exists) {
                    alert('That group code is already taken. Choose another or leave blank to auto-generate.');
                    return;
                }
                finalCode = codeInput;
            } else {
                finalCode = await generateGroupCode(6);
            }
            console.log('[CreateGroup] Final code selected:', finalCode);
            setGroupCode(finalCode);
            setCurrentGroup(finalCode); // triggers map view render
            const resolvedName = groupName.trim() ? groupName.trim() : finalCode;
            setCurrentGroupName(resolvedName);
            // Write meta name
            await database.ref(`groups/${finalCode}/meta`).set({
                name: resolvedName,
                createdAt: Date.now(),
                createdBy: uid
            });
            // Add user member
            await database.ref(`groups/${finalCode}/members/${uid}`).set({
                name: username,
                sport: sport,
                joinedAt: Date.now(),
                owner: true
            });
            // Presence cleanup on disconnect
            database.ref(`groups/${finalCode}/members/${uid}`).onDisconnect().remove();
            database.ref(`groups/${finalCode}/locations/${uid}`).onDisconnect().remove();
            // Kick map init after state commits (tracking starts via useEffect)
            requestAnimationFrame(() => initMapIfNeeded());
        } catch (err) {
            console.error(err);
            alert(err.message);
        }
    };

    // Render username/login screen (force if user hasn't started)
    if (!hasStarted) {
        return (
            <div className="container">
                <div className="auth-container">
                    <h1>🏔️ Group Tracker</h1>
                    <p className="subtitle">Track your friends on the mountain</p>
                    
                    <div>
                        <div className="form-group">
                            <input
                                type="text"
                                placeholder="Your Name (min 2 characters)"
                                value={username}
                                onChange={(e) => {
                                    const newValue = e.target.value;
                                    console.log('[Input] Username changed to:', newValue, 'Length:', newValue.trim().length);
                                    setUsername(newValue);
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        console.log('[Input] Enter key blocked');
                                    }
                                }}
                                className="input"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck="false"
                            />
                        </div>
                        
                        <div className="form-group">
                            <label>Sport:</label>
                            <select 
                                value={sport} 
                                onChange={(e) => setSport(e.target.value)}
                                className="input"
                            >
                                <option value="ski">⛷️ Skiing</option>
                                <option value="bike">🚴 Biking</option>
                            </select>
                        </div>
                        
                        <button 
                            type="button"
                            onClick={() => {
                                console.log('[Button] Clicked. Valid:', isUsernameValid);
                                if (isUsernameValid && username.trim().length >= 2) {
                                    handleSignIn();
                                } else {
                                    console.log('[Button] Blocked - username not valid');
                                }
                            }}
                            className="btn btn-primary"
                            disabled={!isUsernameValid}
                            style={{ opacity: isUsernameValid ? 1 : 0.5, cursor: isUsernameValid ? 'pointer' : 'not-allowed' }}
                        >
                            Get Started
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Render group selection screen
    if (!currentGroup) {
        return (
            <div className="container">
                <div className="auth-container">
                    <h1>Welcome, {username}!</h1>
                    <p className="subtitle">Join or create a group</p>
                    
                    <div className="form-group">
                        <input
                            type="text"
                            placeholder="Group Code (e.g., RIDE32)"
                            value={groupCode}
                            onChange={(e) => setGroupCode(e.target.value.toUpperCase())}
                            className="input"
                            maxLength="8"
                        />
                        <small className="hint">Enter a custom code or leave blank to auto-generate.</small>
                    </div>

                    <div className="form-group">
                        <input
                            type="text"
                            placeholder="Group Name (optional)"
                            value={groupName}
                            onChange={(e) => setGroupName(e.target.value)}
                            className="input"
                            maxLength="24"
                        />
                        <small className="hint">Shown to members. Defaults to code.</small>
                    </div>
                    
                    <button onClick={handleJoinGroup} className="btn btn-primary">
                        Join Group
                    </button>
                    <button onClick={handleCreateGroup} className="btn btn-secondary">
                        Create Group
                    </button>
                    
                    <button onClick={handleSignOut} className="btn btn-secondary">
                        Sign Out
                    </button>
                </div>
            </div>
        );
    }

    // Render main map view
    return (
        <div className="app-container">
            <div className="header">
                <div className="header-info">
                    <h2>{currentGroupName ? `${currentGroupName} (${currentGroup})` : `Group: ${currentGroup}`}</h2>
                    <span className="user-badge">{username} ({sport})</span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button 
                        onClick={() => setPinMode(!pinMode)} 
                        className={`btn btn-small ${pinMode ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ background: pinMode ? '#e74c3c' : undefined }}
                    >
                        {pinMode ? '📍 Click Map to Place' : '📍 Add Pin'}
                    </button>
                    {selectedTrail && (
                        <button 
                            onClick={() => {
                                // Create pin at selected trail location
                                console.log('[Pin] Creating pin for trail:', selectedTrail.name);
                                setPendingPinLocation({ 
                                    lat: selectedTrail.location[0], 
                                    lng: selectedTrail.location[1] 
                                });
                                setPinLabel(selectedTrail.name);
                                setShowPinModal(true);
                            }}
                            className="btn btn-small"
                            style={{ background: '#2ecc71', color: 'white' }}
                        >
                            📍 Pin: {selectedTrail.name.substring(0, 15)}{selectedTrail.name.length > 15 ? '...' : ''}
                        </button>
                    )}
                    <button 
                        onClick={toggleSkiTrails} 
                        className={`btn btn-small ${showSkiTrails ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ background: showSkiTrails ? '#0066ff' : undefined }}
                        disabled={trailsLoading}
                    >
                        {showSkiTrails ? '⛷️ Ski Trails ON' : '⛷️ Ski Trails'}
                    </button>
                    <button 
                        onClick={toggleMtbTrails} 
                        className={`btn btn-small ${showMtbTrails ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ background: showMtbTrails ? '#ff8800' : undefined }}
                        disabled={trailsLoading}
                    >
                        {showMtbTrails ? '🚴 MTB Trails ON' : '🚴 MTB Trails'}
                    </button>
                    <button onClick={handleLeaveGroup} className="btn btn-small">
                        Leave
                    </button>
                </div>
            </div>
            
            <div className="map-container">
                <div ref={mapRef} id="map"></div>
            </div>

            {showLocationPrompt && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 9999
                }}>
                    <div style={{
                        background: '#fff',
                        borderRadius: 12,
                        padding: 20,
                        width: '90%',
                        maxWidth: 420,
                        boxShadow: '0 10px 30px rgba(0,0,0,0.2)'
                    }}>
                        <h3 style={{ marginBottom: 10 }}>Allow Location Access</h3>
                        <p style={{ marginBottom: 16, color: '#555' }}>
                            {locationError || 'To share your live position with the group, please allow location access in your browser settings.'}
                        </p>
                        <button
                            onClick={() => setShowLocationHelp((v) => !v)}
                            className="btn btn-secondary"
                            style={{ width: '100%', marginBottom: 10 }}
                            title="Show quick steps for your browser/device"
                        >
                            {showLocationHelp ? 'Hide help' : 'How to enable location?'}
                        </button>
                        {showLocationHelp && (
                            <div style={{
                                background: '#f8f8f8',
                                border: '1px solid #e0e0e0',
                                borderRadius: 10,
                                padding: 12,
                                marginBottom: 12
                            }}>
                                {/* Chrome (Desktop) */}
                                <details open={detectedPlatform === 'chrome'} style={{ marginBottom: 8 }}>
                                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Chrome (Desktop)</summary>
                                    <ul style={{ marginLeft: 18, marginTop: 6 }}>
                                        <li>Click the lock icon in the address bar.</li>
                                        <li>Permissions → Location → Allow.</li>
                                        <li>Or go to chrome://settings/content/location and add this site to Allow.</li>
                                    </ul>
                                </details>
                                {/* Safari (macOS) */}
                                <details open={detectedPlatform === 'safari'} style={{ marginBottom: 8 }}>
                                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Safari (macOS)</summary>
                                    <ul style={{ marginLeft: 18, marginTop: 6 }}>
                                        <li>Safari → Settings → Websites → Location.</li>
                                        <li>Find this site in the list and set to Allow.</li>
                                        <li>Reload the page and try again.</li>
                                    </ul>
                                </details>
                                {/* iOS (Safari/Chrome) */}
                                <details open={detectedPlatform === 'ios'} style={{ marginBottom: 8 }}>
                                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>iPhone/iPad (iOS)</summary>
                                    <ul style={{ marginLeft: 18, marginTop: 6 }}>
                                        <li>Open Settings → Privacy & Security → Location Services → On.</li>
                                        <li>Scroll to Safari (or your browser) → Allow Location Access → While Using.</li>
                                        <li>Enable Precise Location for best accuracy.</li>
                                        <li>Return to the website and tap Try Again.</li>
                                    </ul>
                                </details>
                                {/* Android (Chrome) */}
                                <details open={detectedPlatform === 'android'} style={{ marginBottom: 8 }}>
                                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Android (Chrome)</summary>
                                    <ul style={{ marginLeft: 18, marginTop: 6 }}>
                                        <li>Ensure system location is On: Settings app → Location → On.</li>
                                        <li>In Chrome: tap the lock icon → Permissions → Location → Allow.</li>
                                        <li>Or Chrome Settings → Site settings → Location → Allow for this site.</li>
                                    </ul>
                                </details>
                                {/* Edge (Desktop) */}
                                <details open={detectedPlatform === 'edge'} style={{ marginBottom: 8 }}>
                                    <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Edge (Desktop)</summary>
                                    <ul style={{ marginLeft: 18, marginTop: 6 }}>
                                        <li>Click the lock icon in the address bar.</li>
                                        <li>Permissions → Location → Allow.</li>
                                        <li>Or edge://settings/content/location and allow this site.</li>
                                    </ul>
                                </details>
                            </div>
                        )}
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                            <button
                                className="btn btn-secondary"
                                onClick={() => setShowLocationPrompt(false)}
                                style={{ width: 'auto' }}
                            >
                                Not Now
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => {
                                    setShowLocationPrompt(false);
                                    // Retry requesting location
                                    stopLocationTracking();
                                    startLocationTracking();
                                }}
                                style={{ width: 'auto' }}
                            >
                                Try Again
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            {showPinModal && (
                <div style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'rgba(0,0,0,0.5)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 10000
                }}>
                    <div style={{
                        background: '#d4cbc0',
                        borderRadius: 12,
                        padding: 20,
                        width: '90%',
                        maxWidth: 400,
                        boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
                        border: '4px solid #2d1b3d'
                    }}>
                        <h3 style={{ marginBottom: 16, color: '#2d1b3d' }}>
                            📍 {selectedTrail ? `Pin Trail: ${selectedTrail.name}` : 'Name Your Pin'}
                        </h3>
                        {selectedTrail && (
                            <div style={{
                                background: '#f0f0f0',
                                padding: 10,
                                borderRadius: 8,
                                marginBottom: 12,
                                border: `2px solid ${selectedTrail.color}`
                            }}>
                                <div style={{ fontSize: '14px', color: '#333' }}>
                                    <strong style={{ color: selectedTrail.color }}>{selectedTrail.type}</strong><br/>
                                    Difficulty: {selectedTrail.difficulty}<br/>
                                    {selectedTrail.description && `Info: ${selectedTrail.description}`}
                                </div>
                            </div>
                        )}
                        <div className="form-group">
                            <input
                                type="text"
                                placeholder="Enter pin name"
                                value={pinLabel}
                                onChange={(e) => setPinLabel(e.target.value)}
                                className="input"
                                autoFocus
                                maxLength="32"
                            />
                        </div>
                        <div className="form-group">
                            <label>Time:</label>
                            <input
                                type="time"
                                value={pinTime}
                                onChange={(e) => setPinTime(e.target.value)}
                                className="input"
                            />
                        </div>
                        <div className="form-group">
                            <button
                                className="btn btn-secondary"
                                onClick={() => {
                                    setShowPinModal(false);
                                    setPinLabel('');
                                    setSelectedTrail(null);
                                }}
                                style={{ width: 'auto', marginBottom: 0 }}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => {
                                    if (pinLabel.trim()) {
                                        const pinId = Date.now().toString();
                                        const now = Date.now();
                                        const fiveMinutes = 5 * 60 * 1000; // 5 minutes in milliseconds
                                        
                                        const pinData = {
                                            lat: pendingPinLocation.lat,
                                            lon: pendingPinLocation.lng,
                                            label: pinLabel.trim(),
                                            pinTime: pinTime,
                                            createdBy: username,
                                            createdAt: now,
                                            expiresAt: now + fiveMinutes
                                        };
                                        
                                        // Add trail info if this is a trail pin
                                        if (selectedTrail) {
                                            pinData.trail = {
                                                name: selectedTrail.name,
                                                type: selectedTrail.type,
                                                difficulty: selectedTrail.difficulty,
                                                color: selectedTrail.color
                                            };
                                        }
                                        
                                        database.ref(`groups/${currentGroup}/pins/${pinId}`).set(pinData);
                                        setShowPinModal(false);
                                        setPinLabel('');
                                        setPinTime('');
                                        setPinMode(false);
                                        setSelectedTrail(null);
                                        
                                        console.log('[Pin] Created pin:', pinData);
                                    }
                                }}
                                style={{ width: 'auto', marginBottom: 0 }}
                            >
                                Add Pin
                            </button>
                        </div>
                    </div>
                </div>
            )}
            
            <div className="members-panel">
                <h3>Group Members ({Object.keys(groupMembers).length})</h3>
                <div className="members-list">
                    {Object.entries(groupMembers).map(([userId, data]) => (
                        <div 
                            key={userId} 
                            className="member-item"
                            onClick={() => {
                                if (data.lat && data.lon && mapInstanceRef.current) {
                                    mapInstanceRef.current.flyTo([data.lat, data.lon], 16, {
                                        animate: true,
                                        duration: 1
                                    });
                                    // Open the marker popup if it exists
                                    if (markersRef.current[userId]) {
                                        markersRef.current[userId].openPopup();
                                    }
                                }
                            }}
                            style={{ cursor: 'pointer' }}
                        >
                            <span className={`sport-icon ${data.sport}`}>
                                {data.sport === 'ski' ? '⛷️' : '🚴'}
                            </span>
                            <div className="member-info">
                                <strong>{data.name}</strong>
                                <small>
                                    {data.timestamp 
                                        ? `Updated ${Math.round((Date.now() - data.timestamp) / 1000)}s ago`
                                        : 'No location yet'}
                                </small>

                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// Render the app
ReactDOM.render(<App />, document.getElementById('root'));