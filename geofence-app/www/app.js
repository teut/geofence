// import { Haptics, ImpactStyle } from '@capacitor/haptics';
// import { Geolocation } from '@capacitor/geolocation';
const { Haptics, ImpactStyle, Geolocation } = Capacitor.Plugins;

// Background GPS tracking
const watch = await Geolocation.watchPosition(
  {
    enableHighAccuracy: true,
    timeout: 10000
  },
  (position, err) => {
    console.log(position);
  }
);

// // Haptic feedback
// async function vibrateAlarm() {
//   await Haptics.impact({
//     style: ImpactStyle.Heavy
//   });
// }

// -----------------------------
// MAP SETUP
// -----------------------------
const map = L.map('map').setView([51.0, 4.0], 15);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// -----------------------------
// STATE
// -----------------------------
let userMarker = null;
let polygonPoints = [];
let polygon = null;
let drawingLine = null;
let boundaryFinished = false;
let currentlyOutside = false;

const statusEl = document.getElementById('status');
const alertOverlay = document.getElementById('alertOverlay');

const polygonNameInput = document.getElementById('polygonName');
const savedPolygonsSelect = document.getElementById('savedPolygons');

// -----------------------------
// INIT
// -----------------------------
refreshSavedPolygonDropdown();

// -----------------------------
// AUDIO BEEP
// -----------------------------
let audioCtx;
let audioUnlocked = false;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }

    audioUnlocked = true;
}

// MUST be called from user gesture (important for iPhone)
document.body.addEventListener('touchstart', initAudio, { once: true });

function beep() {
    if (!audioUnlocked || !audioCtx) return;

    const oscillator = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.value = 880;

    gain.gain.setValueAtTime(0.25, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(
        0.0001,
        audioCtx.currentTime + 0.3
    );

    oscillator.connect(gain);
    gain.connect(audioCtx.destination);

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + 0.3);
}

function alertOutside() {
    beep();

    if (navigator.vibrate) {
        navigator.vibrate([300, 100, 300]);
    }
    // vibrateAlarm();
}

document
    .getElementById('testSoundBtn')
    .addEventListener('click', () => {
        initAudio();
        beep();
    });

// -----------------------------
// POINT IN POLYGON
// -----------------------------
function isPointInPolygon(point, vs) {
    const x = point.lng, y = point.lat;

    let inside = false;

    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
        const xi = vs[i].lng, yi = vs[i].lat;
        const xj = vs[j].lng, yj = vs[j].lat;

        const intersect =
            ((yi > y) !== (yj > y)) &&
            (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

        if (intersect) inside = !inside;
    }

    return inside;
}

// -----------------------------
// DRAW POINTS
// -----------------------------
function addPolygonPoint(latlng) {
    polygonPoints.push(latlng);

    L.circleMarker(latlng, {
        radius: 6,
        color: '#00ff88'
    }).addTo(map);

    redrawShape();
    refreshCoordinateList();
}

map.on('click', (e) => {

    // If menu is open:
    // close it and DO NOT add point
    if (!sideMenu.classList.contains('closed')) {

        sideMenu.classList.add('closed');

        return;
    }

    if (boundaryFinished) return;

    addPolygonPoint(e.latlng);

});

function redrawShape() {
    if (drawingLine) {
        map.removeLayer(drawingLine);
    }

    drawingLine = L.polyline(polygonPoints, {
        color: '#00ff88',
        weight: 3
    }).addTo(map);
}

// -----------------------------
// MANUAL COORDINATE ENTRY
// -----------------------------
document
    .getElementById('addCoordBtn')
    .addEventListener('click', () => {

        if (boundaryFinished) return;

        const lat = parseFloat(
            document.getElementById('latInput').value
        );

        const lng = parseFloat(
            document.getElementById('lngInput').value
        );

        if (isNaN(lat) || isNaN(lng)) {
            alert('Enter valid coordinates.');
            return;
        }

        const latlng = {
            lat,
            lng
        };

        addPolygonPoint(latlng);

        map.panTo(latlng);

        document.getElementById('latInput').value = '';
        document.getElementById('lngInput').value = '';
    });

// -----------------------------
// SAVE POLYGON
// -----------------------------
document
    .getElementById('savePolygonBtn')
    .addEventListener('click', () => {

        if (polygonPoints.length < 3) {
            alert('Create a polygon first.');
            return;
        }

        const name =
            polygonNameInput.value.trim();

        if (!name) {
            alert('Enter a polygon name.');
            return;
        }

        const data = getSavedPolygons();

        data[name] = polygonPoints.map(p => ({
            lat: p.lat,
            lng: p.lng
        }));

        savePolygonsToStorage(data);

        refreshSavedPolygonDropdown();

        alert('Polygon saved.');

    });
// -----------------------------
// COORDINATE LIST UI
// -----------------------------
const coordList = document.getElementById('coordList');

function refreshCoordinateList() {
    if (polygonPoints.length === 0) {
        coordList.innerHTML = 'No points yet.';
        return;
    }

    coordList.innerHTML = polygonPoints
        .map((p, index) => `
<div style="
padding:4px 0;
border-bottom:1px solid rgba(255,255,255,0.08);
">
${index + 1}.
${p.lat.toFixed(6)},
${p.lng.toFixed(6)}
</div>
`)
        .join('');
}

// -----------------------------
// LOCAL STORAGE
// -----------------------------
function getSavedPolygons() {
    return JSON.parse(
        localStorage.getItem('savedPolygons') || '{}'
    );
}

function savePolygonsToStorage(data) {
    localStorage.setItem(
        'savedPolygons',
        JSON.stringify(data)
    );
}

function refreshSavedPolygonDropdown() {

    const data = getSavedPolygons();

    savedPolygonsSelect.innerHTML = `
<option value="">
Select saved polygon
</option>
`;

    Object.keys(data).forEach(name => {

        const option =
            document.createElement('option');

        option.value = name;
        option.textContent = name;

        savedPolygonsSelect.appendChild(option);

    });

}

// -----------------------------
// LOAD POLYGON
// -----------------------------
document
    .getElementById('loadPolygonBtn')
    .addEventListener('click', () => {

        const selected =
            savedPolygonsSelect.value;

        if (!selected) {
            alert('Select a polygon.');
            return;
        }

        const data = getSavedPolygons();

        const points = data[selected];

        if (!points || points.length < 3) {
            alert('Invalid polygon.');
            return;
        }

        // Clear existing
        polygonPoints = [];
        boundaryFinished = false;

        if (polygon) {
            map.removeLayer(polygon);
            polygon = null;
        }

        if (drawingLine) {
            map.removeLayer(drawingLine);
            drawingLine = null;
        }

        map.eachLayer(layer => {

            if (
                layer instanceof L.CircleMarker &&
                layer !== userMarker
            ) {
                map.removeLayer(layer);
            }

        });

        // Load points
        points.forEach(p => {

            addPolygonPoint({
                lat: p.lat,
                lng: p.lng
            });

        });

        // Auto-finish polygon
        boundaryFinished = true;

        if (drawingLine) {
            map.removeLayer(drawingLine);
        }

        polygon = L.polygon(polygonPoints, {
            color: '#00ff88',
            fillColor: '#00ff88',
            fillOpacity: 0.2
        }).addTo(map);

        map.fitBounds(polygon.getBounds());

        sideMenu.classList.add('closed');

        statusEl.innerHTML = `
Loaded polygon:
<br>
<strong>${selected}</strong>
`;

    });

// -----------------------------
// FINISH POLYGON
// -----------------------------
document.getElementById('finishBtn').addEventListener('click', () => {
    if (polygonPoints.length < 3) {
        alert('You need at least 3 points.');
        return;
    }

    boundaryFinished = true;

    if (drawingLine) {
        map.removeLayer(drawingLine);
    }

    polygon = L.polygon(polygonPoints, {
        color: '#00ff88',
        fillColor: '#00ff88',
        fillOpacity: 0.2
    }).addTo(map);

    map.fitBounds(polygon.getBounds());

    statusEl.innerHTML = `
Boundary active.<br>
Stay inside the green area.
`;

    sideMenu.classList.add('closed');

});

// -----------------------------
// CLEAR
// -----------------------------
document.getElementById('clearBtn').addEventListener('click', () => {
    polygonPoints = [];
    boundaryFinished = false;
    currentlyOutside = false;

    if (polygon) {
        map.removeLayer(polygon);
        polygon = null;
    }

    if (drawingLine) {
        map.removeLayer(drawingLine);
        drawingLine = null;
    }

    map.eachLayer(layer => {
        if (
            layer instanceof L.CircleMarker &&
            layer !== userMarker
        ) {
            map.removeLayer(layer);
        }
    });

    alertOverlay.style.display = 'none';

    statusEl.innerHTML = 'Boundary cleared.';
});

// -----------------------------
// GPS TRACKING
// -----------------------------
function onLocationUpdate(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;
    const accuracy = position.coords.accuracy;

    const latlng = [lat, lng];

    if (!userMarker) {
        userMarker = L.circleMarker(latlng, {
            radius: 10,
            color: '#0a84ff',
            fillColor: '#0a84ff',
            fillOpacity: 1
        }).addTo(map);

        map.setView(latlng, 18);
    } else {
        userMarker.setLatLng(latlng);
    }

    statusEl.innerHTML = `
GPS Active<br>
Lat: ${lat.toFixed(5)}<br>
Lng: ${lng.toFixed(5)}<br>
Accuracy: ${accuracy.toFixed(1)}m
`;

    if (boundaryFinished && polygonPoints.length >= 3) {
        const inside = isPointInPolygon(
            { lat, lng },
            polygonPoints
        );

        if (!inside) {
            if (!currentlyOutside) {
                alertOutside();
            }

            currentlyOutside = true;

            alertOverlay.style.display = 'block';

            statusEl.innerHTML += `
    <br><br>
    <span style="color:#ff453a;font-weight:bold;">
    OUTSIDE BOUNDARY
    </span>
`;
        } else {
            currentlyOutside = false;
            alertOverlay.style.display = 'none';
        }
    }
}

function onLocationError(err) {
    statusEl.innerHTML = `
GPS Error:<br>
${err.message}
`;
}

navigator.geolocation.watchPosition(
    onLocationUpdate,
    onLocationError,
    {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000
    }
);

// -----------------------------
// iPhone Audio Unlock
// -----------------------------
document.body.addEventListener('touchstart', async () => {
    if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
    }
}, { once: true });

// -----------------------------
// HAMBURGER MENU
// -----------------------------
const sideMenu =
    document.getElementById('sideMenu');

const menuToggle =
    document.getElementById('menuToggle');

menuToggle.addEventListener('click', () => {

    sideMenu.classList.toggle('closed');

});

