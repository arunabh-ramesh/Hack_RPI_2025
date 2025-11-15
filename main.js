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
    const mapRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const markersRef = useRef({});

    // Authentication state listener
    useEffect(() => {
        const unsubscribe = auth.onAuthStateChanged((user) => {
            setUser(user);
        });
        return () => unsubscribe();
    }, []);

    // Initialize map when we have a group
    useEffect(() => {
        if (currentGroup && mapRef.current && !mapInstanceRef.current) {
            console.log('Initializing map...');
            try {
                // Default to Whistler, BC
                const map = L.map(mapRef.current).setView([50.1163, -122.9574], 13);
                
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '© OpenStreetMap contributors',
                    maxZoom: 18
                }).addTo(map);
                
                mapInstanceRef.current = map;
                console.log('Map initialized successfully');
                
                // Force map to resize after a short delay
                setTimeout(() => {
                    map.invalidateSize();
                }, 100);
            } catch (error) {
                console.error('Error initializing map:', error);
            }
        }
    }, [currentGroup]);

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

    // Start location tracking when group is joined
    useEffect(() => {
        if (currentGroup && user && !watchId) {
            console.log('Group joined, starting location tracking for group:', currentGroup);
            startLocationTracking();
        }
    }, [currentGroup, user]);

    // Start location tracking
    const startLocationTracking = () => {
        console.log('Starting location tracking...');
        console.log('User:', user?.uid, 'Group:', currentGroup, 'Username:', username);
        
        if (!navigator.geolocation) {
            console.log('Geolocation not supported, using simulated location');
            useSimulatedLocation();
            return;
        }

        // Try to get real location first
        const id = navigator.geolocation.watchPosition(
            (position) => {
                const { latitude, longitude } = position.coords;
                console.log('Real location updated:', latitude, longitude);
                
                if (user && currentGroup) {
                    database.ref(`groups/${currentGroup}/locations/${user.uid}`).set({
                        name: username,
                        sport: sport,
                        lat: latitude,
                        lon: longitude,
                        timestamp: Date.now()
                    }).then(() => {
                        console.log('✅ Real location saved to Firebase!');
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
                console.log('Falling back to simulated location');
                useSimulatedLocation();
            },
            {
                enableHighAccuracy: true,
                maximumAge: 10000,
                timeout: 10000
            }
        );

        setWatchId(id);
    };

    // Use simulated location as fallback
    const useSimulatedLocation = () => {
        const updateSimulatedLocation = () => {
            const simulatedLat = 50.1163 + (Math.random() - 0.5) * 0.01;
            const simulatedLon = -122.9574 + (Math.random() - 0.5) * 0.01;
            
            console.log('Updating simulated location:', simulatedLat, simulatedLon);
            
            if (user && currentGroup) {
                database.ref(`groups/${currentGroup}/locations/${user.uid}`).set({
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
        
        // Initial update
        updateSimulatedLocation();
        
        // Update every 5 seconds
        const simulationInterval = setInterval(updateSimulatedLocation, 5000);
        setWatchId(simulationInterval);
        
        console.log('✅ Simulated location tracking started!');
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
        
        console.log('Joining group:', code);
        
        // Add user to group members
        await database.ref(`groups/${code}/members/${user.uid}`).set({
            name: username,
            sport: sport,
            joinedAt: Date.now()
        });

        // Set current group (this will trigger location tracking via useEffect)
        setCurrentGroup(code);
    };

    // Leave group
    const handleLeaveGroup = async () => {
        stopLocationTracking();
        
        if (user && currentGroup) {
            await database.ref(`groups/${currentGroup}/locations/${user.uid}`).remove();
            await database.ref(`groups/${currentGroup}/members/${user.uid}`).remove();
        }
        
        setCurrentGroup(null);
        setGroupCode('');
    };

    // Sign out
    const handleSignOut = async () => {
        handleLeaveGroup();
        await auth.signOut();
        setUsername('');
    };

    // Render login screen
    if (!user) {
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
                            maxLength="6"
                        />
                    </div>
                    
                    <button onClick={handleJoinGroup} className="btn btn-primary">
                        Join Group
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
                    <h2>Group: {currentGroup}</h2>
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