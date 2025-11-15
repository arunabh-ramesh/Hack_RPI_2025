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
    const [groupCode, setGroupCode] = useState('');
    const [currentGroup, setCurrentGroup] = useState(null);
    const [username, setUsername] = useState('');
    const [sport, setSport] = useState('ski');
    const [groupMembers, setGroupMembers] = useState({});
    const [watchId, setWatchId] = useState(null);
    const [groupName, setGroupName] = useState(''); // name to create
    const [currentGroupName, setCurrentGroupName] = useState(null); // name after join/create
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const markersRef = useRef({});

    // Centralized map initialization to avoid race conditions
    const initMapIfNeeded = () => {
        if (!currentGroup) return;
        if (!mapRef.current) return; // DOM not attached yet
        if (mapInstanceRef.current) return; // Already initialized
        try {
            console.log('[Map] Initializing map for group', currentGroup);
            const map = L.map(mapRef.current).setView([39.1911, -106.8175], 13);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '© OpenStreetMap contributors',
                maxZoom: 18
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
            const code = Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
            
            
            
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
        });
        return () => unsubscribe();
    }, []);

    // Always start at username entry: sign out any persisted anonymous session
    useEffect(() => {
        // If there is a pre-existing session (e.g. page reload), sign out to force username screen
        if (auth.currentUser) {
            auth.signOut().catch(e => console.warn('Initial signOut failed', e));
            setUsername('');
        }
    }, []);

    // Initialize map when group changes
    useEffect(() => {
        initMapIfNeeded();
    }, [currentGroup]);

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

    // Fallback cleanup on browser/tab close
    useEffect(() => {
        if (!currentGroup || !user) return;
        const handleBeforeUnload = () => {
            // No immediate removals; onDisconnect already queued
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
                        const icon = L.divIcon({
                            className: 'custom-marker',
                            html: `<div class="marker-${data.sport}">
                                      <div class="marker-label">${data.name}</div>
                                   </div>`,
                            iconSize: [40, 40]
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

    // Start location tracking
    const startLocationTracking = () => {
        if (!navigator.geolocation) {
            alert('Geolocation is not supported by your browser');
            return;
        }

        const id = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                
                // Update Firebase with current location
                if (user && currentGroup) {
                    database.ref(`groups/${currentGroup}/locations/${user.uid}`).set({
                        name: username,
                        sport: sport,
                        lat: latitude,
                        lon: longitude,
                        timestamp: Date.now()
                    });

                    // Center map on user location
                    if (mapInstanceRef.current) {
                        mapInstanceRef.current.setView([latitude, longitude], 15);
                    }
                }
            },
            (error) => {
                console.error('Error getting location:', error);
            },
            {
                enableHighAccuracy: true,
                maximumAge: 0,
                timeout: 5000
            }
        );

        setWatchId(id);
    };

    // Stop location tracking
    const stopLocationTracking = () => {
        if (watchId) {
            navigator.geolocation.clearWatch(watchId);
            setWatchId(null);
        }
    };

    // Anonymous sign in
    const handleSignIn = async () => {
        if (!username.trim()) {
            alert('Please enter your name');
            return;
        }
        
        try {
            await auth.signInAnonymously();
        } catch (error) {
            console.error('Error signing in:', error);
            alert('Error signing in: ' + error.message);
        }
    };

    // Join group
    const handleJoinGroup = async () => {
        if (!groupCode.trim()) {
            alert('Please enter a group code');
            return;
        }

        const code = groupCode.toUpperCase();
        
        try {
            // Fetch meta name if exists
            const metaSnap = await database.ref(`groups/${code}/meta/name`).once('value');
            let groupName = null;
            if (metaSnap.exists()) {
                groupName = metaSnap.val();
            }
            
            // Add user to group members
            await database.ref(`groups/${code}/members/${user.uid}`).set({
                name: username,
                sport: sport,
                joinedAt: Date.now()
            });

            // Presence cleanup on disconnect
            database.ref(`groups/${code}/members/${user.uid}`).onDisconnect().remove();
            database.ref(`groups/${code}/locations/${user.uid}`).onDisconnect().remove();

            // Only update state after successful database operations
            setCurrentGroup(code);
            setCurrentGroupName(groupName);

            // Start tracking location
            startLocationTracking();
        } catch (e) {
            console.error('Error joining group:', e);
            alert('Failed to join group. Please try again.');
        }
    };

    // Leave group
    const handleLeaveGroup = async () => {
        stopLocationTracking();
        
        if (user && currentGroup) {
            await database.ref(`groups/${currentGroup}/locations/${user.uid}`).remove();
            await database.ref(`groups/${currentGroup}/members/${user.uid}`).remove();
            // After leaving, attempt cleanup after a short delay to avoid race conditions
            setTimeout(() => cleanupGroupIfEmpty(currentGroup), 1000);
        }
        
        setCurrentGroup(null);
        setGroupCode('');
        setCurrentGroupName(null);
    };

    // Sign out
    const handleSignOut = async () => {
        handleLeaveGroup();
        await auth.signOut();
        setUsername('');
    };

    // Create new group with generated code
    const handleCreateGroup = async () => {
        if (!username.trim()) {
            alert('Enter your name first');
            return;
        }
        if (!user || !user.uid) {
            alert('You must be signed in to create a group. Please wait for authentication to complete.');
            return;
        }
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
            const trimmedGroupName = groupName.trim();
            const resolvedName = trimmedGroupName ? trimmedGroupName : finalCode;
            setCurrentGroupName(resolvedName);
            // Write meta name
            await database.ref(`groups/${finalCode}/meta`).set({
                name: resolvedName,
                createdAt: Date.now(),
                createdBy: user.uid
            });
            // Add user member
            await database.ref(`groups/${finalCode}/members/${user.uid}`).set({
                name: username,
                sport: sport,
                joinedAt: Date.now(),
                owner: true
            });
            // Presence cleanup on disconnect
            database.ref(`groups/${finalCode}/members/${user.uid}`).onDisconnect().remove();
            database.ref(`groups/${finalCode}/locations/${user.uid}`).onDisconnect().remove();
            // Kick map init after state commits
            requestAnimationFrame(() => initMapIfNeeded());
            startLocationTracking();
        } catch (err) {
            console.error(err);
            alert(err.message);
        }
    };

    // Render username/login screen (force if username not set)
    if (!user || !username) {
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
                        {user ? 'Continue' : 'Get Started'}
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
                <button onClick={handleLeaveGroup} className="btn btn-small">
                    Leave
                </button>
            </div>
            
            <div className="map-container">
                <div ref={mapRef} id="map"></div>
            </div>
            
            <div className="members-panel">
                <h3>Group Members ({Object.keys(groupMembers).length})</h3>
                <div className="members-list">
                    {Object.entries(groupMembers).map(([userId, data]) => (
                        <div key={userId} className="member-item">
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