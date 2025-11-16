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
    const [hasStarted, setHasStarted] = useState(false); // Track if user confirmed sign-in
    const mapInstanceRef = useRef(null);
    const markersRef = useRef({});
    const pinMarkersRef = useRef({});
    const pinModeRef = useRef(false);
    const mapClickHandlerRef = useRef(null);
    const mapRef = useRef(null);



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

    // Centralized map initialization to avoid race conditions
    const initMapIfNeeded = () => {
        if (!currentGroup) return;
        if (!mapRef.current) return; // DOM not attached yet
        if (mapInstanceRef.current) return; // Already initialized
        try {
            console.log('[Map] Initializing map for group', currentGroup);
            const map = L.map(mapRef.current).setView([42.7285, -73.6852], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
            }).addTo(map);
            
            // Add OpenSnowMap ski trails overlay
            const pisteLayer = L.tileLayer('https://tiles.opensnowmap.org/pistes/{z}/{x}/{y}.png', {
                attribution: '© OpenSnowMap contributors | © OpenStreetMap contributors',
                maxZoom: 18,
                opacity: 0.8,
                interactive: false
            }).addTo(map);
            
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
                        
                        marker.bindPopup(`
                            <strong>${data.label}</strong><br>
                            Time: ${data.pinTime || 'N/A'}<br>
                            By: ${data.createdBy}<br>
                            Created: ${new Date(data.createdAt).toLocaleString()}<br>
                            Expires: ${new Date(data.expiresAt).toLocaleString()}<br>
                            <button onclick="if(confirm('Delete this pin?')) { firebase.database().ref('groups/${currentGroup}/pins/${pinId}').remove(); }" style="margin-top:8px;padding:4px 8px;background:#e74c3c;color:white;border:none;border-radius:4px;cursor:pointer;">Delete Pin</button>
                        `);
                        
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
                        mapInstanceRef.current.setView([latitude, longitude], 15);
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
                    mapInstanceRef.current.setView([simulatedLat, simulatedLon], 15);
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
        if (!username.trim()) {
            alert('Please enter your name');
            return;
        }
        
        if (signingIn) return; // Prevent duplicate sign-in attempts
        setSigningIn(true);
        
        try {
            // Only sign in if not already signed in
            if (!auth.currentUser) {
                await auth.signInAnonymously();
            }
            // Only set hasStarted after successful authentication
            setHasStarted(true);
        } catch (error) {
            console.error('Error signing in:', error);
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
                    
                    <div className="form-group">
                        <input
                            type="text"
                            placeholder="Your Name"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            className="input"
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
                    
                    <button onClick={handleSignIn} className="btn btn-primary">
                        Get Started
                    </button>
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
                <div style={{ display: 'flex', gap: 8 }}>
                    <button 
                        onClick={() => setPinMode(!pinMode)} 
                        className={`btn btn-small ${pinMode ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ background: pinMode ? '#e74c3c' : undefined }}
                    >
                        {pinMode ? '📍 Click Map to Place' : '📍 Add Pin'}
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
                        <h3 style={{ marginBottom: 16, color: '#2d1b3d' }}>📍 Name Your Pin</h3>
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
                                        database.ref(`groups/${currentGroup}/pins/${pinId}`).set({
                                            lat: pendingPinLocation.lat,
                                            lon: pendingPinLocation.lng,
                                            label: pinLabel.trim(),
                                            pinTime: pinTime,
                                            createdBy: username,
                                            createdAt: now,
                                            expiresAt: now + fiveMinutes
                                        });
                                        setShowPinModal(false);
                                        setPinLabel('');
                                        setPinTime('');
                                        setPinMode(false);
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
                                    mapInstanceRef.current.setView([data.lat, data.lon], 16);
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