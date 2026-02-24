import { useEffect, useMemo, useRef, useState } from "react";

const HANDS_SRC = "https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js";
const CAMERA_SRC = "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js";
const scriptCache = new Map();

const COLORS = [
  { name: "Black", value: "#000000" },
  { name: "Red", value: "#ff5a5f" },
  { name: "Blue", value: "#0066ff" },
];

const SIZES = [2, 5, 10, 15, 20];

const PINCH_THRESHOLD = 30;
const PINCH_SCALE = 0.5;
const PINCH_HYSTERESIS = 1.2;
const PINCH_FRAMES = 3;
const DRAW_DELAY_MS = 100;
const SMOOTHING = 0.3;
const CURSOR_RADIUS = 12;

async function loadMediapipeModule(globalName, src) {
  if (typeof window === "undefined") return null;
  if (window[globalName]) return window[globalName];

  if (scriptCache.has(src)) {
    return scriptCache.get(src);
  }

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => {
      scriptCache.set(src, window[globalName]);
      resolve(window[globalName]);
    };
    document.head.appendChild(script);
  });
}

function distance(a, b) {
  return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
}

function drawStroke(ctx, from, to, color, size) {
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

function projectLandmark(landmark, canvas) {
  if (!canvas) return { x: landmark.x, y: landmark.y };
  return {
    x: (1 - landmark.x) * canvas.width,
    y: landmark.y * canvas.height
  };
}

export default function App() {
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(5);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const videoRef = useRef(null);
  const paintCanvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const containerRef = useRef(null);
  const handsRef = useRef(null);
  const cameraRef = useRef(null);
  const prevPointRef = useRef(null);
  const smoothedPointRef = useRef(null);
  const pinchActiveRef = useRef(false);
  const pinchFramesRef = useRef(0);
  const pinchStartTimeRef = useRef(0);
  const colorRef = useRef(color);
  const sizeRef = useRef(size);

  const statusLabel = error || (ready ? "Ready to paint" : "Camera disabled");

  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  useEffect(() => {
    let cancelled = false;

    loadMediapipeModule("Hands", HANDS_SRC)
      .then((HandsApi) => {
        if (cancelled || !HandsApi) {
          throw new Error("Hands API unavailable");
        }

        const hands = new HandsApi({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5
        });

        hands.onResults((results) => {
          const overlayCanvas = overlayCanvasRef.current;
          const paintCanvas = paintCanvasRef.current;
          if (!overlayCanvas || !paintCanvas) return;

          const overlayCtx = overlayCanvas.getContext("2d");
          const paintCtx = paintCanvas.getContext("2d");
          overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

          const landmarks = results.multiHandLandmarks?.[0];
          if (!landmarks) {
            prevPointRef.current = null;
            smoothedPointRef.current = null;
            pinchActiveRef.current = false;
            pinchFramesRef.current = 0;
            pinchStartTimeRef.current = 0;
            return;
          }

          const indexTip = projectLandmark(landmarks[8], paintCanvas);
          const thumbTip = projectLandmark(landmarks[4], paintCanvas);
          const wrist = projectLandmark(landmarks[0], paintCanvas);
          const middleBase = projectLandmark(landmarks[9], paintCanvas);
          const handSize = distance(wrist, middleBase);
          const pinchThreshold = Math.max(PINCH_THRESHOLD, handSize * PINCH_SCALE);
          const pinchOn = pinchThreshold;
          const pinchOff = pinchThreshold * PINCH_HYSTERESIS;
          const pinchDistance = distance(indexTip, thumbTip);

          if (pinchActiveRef.current) {
            if (pinchDistance > pinchOff) {
              pinchActiveRef.current = false;
              pinchFramesRef.current = 0;
              pinchStartTimeRef.current = 0;
            }
          } else if (pinchDistance < pinchOn) {
            pinchFramesRef.current += 1;
            if (pinchFramesRef.current >= PINCH_FRAMES) {
              pinchActiveRef.current = true;
              pinchStartTimeRef.current = performance.now();
            }
          } else {
            pinchFramesRef.current = 0;
          }

          const pinch = pinchActiveRef.current;
          const canDraw =
            pinch && performance.now() - (pinchStartTimeRef.current || 0) >= DRAW_DELAY_MS;

          const point = indexTip;

          const last = smoothedPointRef.current || point;
          const smoothed = {
            x: last.x + (point.x - last.x) * SMOOTHING,
            y: last.y + (point.y - last.y) * SMOOTHING
          };
          smoothedPointRef.current = smoothed;

          overlayCtx.beginPath();
          overlayCtx.fillStyle = pinch ? "#ff5a5f" : "#111111";
          overlayCtx.arc(smoothed.x, smoothed.y, CURSOR_RADIUS, 0, Math.PI * 2);
          overlayCtx.fill();

          if (canDraw) {
            const previous = prevPointRef.current;
            if (previous) {
              drawStroke(paintCtx, previous, smoothed, colorRef.current, sizeRef.current);
            }
            prevPointRef.current = smoothed;
          } else {
            prevPointRef.current = null;
          }
        });

        handsRef.current = hands;
      })
      .catch(() => {
        if (!cancelled) {
          setError("Failed to load Mediapipe Hands. Check your network connection.");
        }
      });

    return () => {
      cancelled = true;
      if (handsRef.current) {
        handsRef.current.close();
        handsRef.current = null;
      }
    };
  }, []);

  const startCamera = async () => {
    setError("");
    const video = videoRef.current;
    const hands = handsRef.current;
    if (!video || !hands) return;

    if (cameraRef.current) {
      setReady(true);
      return;
    }

    try {
      const CameraApi = await loadMediapipeModule("Camera", CAMERA_SRC);
      if (!CameraApi) {
        setError("Mediapipe camera utilities failed to load.");
        setReady(false);
        return;
      }

      const camera = new CameraApi(video, {
        onFrame: async () => {
          await hands.send({ image: video });
        },
        width: 1920,
        height: 1080
      });

      cameraRef.current = camera;
      await camera.start();
      setReady(true);

      const paintCanvas = paintCanvasRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      if (paintCanvas && overlayCanvas) {
        paintCanvas.width = video.videoWidth || 1280;
        paintCanvas.height = video.videoHeight || 720;
        overlayCanvas.width = video.videoWidth || 1280;
        overlayCanvas.height = video.videoHeight || 720;
      }
    } catch (err) {
      setError("Unable to access camera. Check permissions.");
      setReady(false);
    }
  };

  const clearCanvas = () => {
    const paintCanvas = paintCanvasRef.current;
    if (!paintCanvas) return;
    const ctx = paintCanvas.getContext("2d");
    ctx.clearRect(0, 0, paintCanvas.width, paintCanvas.height);
  };

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Gesture Painting</p>
          <h1>Hand Tracking Paintbrush</h1>
          <p className="subtext">
            Pinch your thumb and index finger to paint. Release to stop.
          </p>
        </div>
        <div className="controls">
          <button className="primary" onClick={startCamera}>
            {ready ? "Camera Ready" : "Enable Camera"}
          </button>
          <button className="ghost" onClick={clearCanvas}>
            Clear Canvas
          </button>
          <span className={`status ${ready ? "ready" : "off"}`}>{statusLabel}</span>
        </div>
      </header>

      <main className="stage" ref={containerRef}>
        <div className="canvas-wrap">
          <video ref={videoRef} className="video" playsInline muted autoPlay />
          <canvas ref={paintCanvasRef} className="paint-canvas" />
          <canvas ref={overlayCanvasRef} className="overlay-canvas" />
        </div>
        <aside className="toolbar">
          <div className="section">
            <h3>Colors</h3>
            <div className="row">
              {COLORS.map((item) => (
                <button
                  key={item.value}
                  className={`swatch ${color === item.value ? "active" : ""}`}
                  style={{ backgroundColor: item.value }}
                  onClick={() => setColor(item.value)}
                  title={item.name}
                />
              ))}
            </div>
          </div>
          <div className="section">
            <h3>Brush Size</h3>
            <div className="row">
              {SIZES.map((value) => (
                <button
                  key={value}
                  className={`size ${size === value ? "active" : ""}`}
                  onClick={() => setSize(value)}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
          <div className="section tips">
            <h3>Tips</h3>
            <p>Keep your hand within view of the camera.</p>
            <p>Pinch to draw, release to stop.</p>
          </div>
        </aside>
      </main>
    </div>
  );
}
