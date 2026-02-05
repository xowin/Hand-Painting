import React, { useEffect, useMemo, useRef, useState } from "react";
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";

const COLORS = [
  { name: "Black", value: "#0b0b0b" },
  { name: "Coral", value: "#ff5a5f" },
  { name: "Sun", value: "#ffb703" },
  { name: "Sky", value: "#219ebc" },
  { name: "Mint", value: "#2ec4b6" },
  { name: "Violet", value: "#6c5ce7" }
];

const SIZES = [4, 8, 14, 22];

const PINCH_THRESHOLD = 0.045;
const CURSOR_RADIUS = 8;
const SMOOTHING = 0.35;
const PINCH_SCALE = 0.25;
const PINCH_HYSTERESIS = 1.4;
const PINCH_FRAMES = 2;
const DRAW_DELAY_MS = 600;

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function drawStroke(ctx, from, to, color, size) {
  if (!from || !to) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

export default function App() {
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
  const colorRef = useRef(COLORS[0].value);
  const sizeRef = useRef(SIZES[1]);

  const [color, setColor] = useState(COLORS[0].value);
  const [size, setSize] = useState(SIZES[1]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");

  const statusLabel = useMemo(() => {
    if (error) return error;
    return ready ? "Camera active" : "Camera off";
  }, [ready, error]);

  useEffect(() => {
    function syncCanvas() {
      const paintCanvas = paintCanvasRef.current;
      const overlayCanvas = overlayCanvasRef.current;
      const video = videoRef.current;
      if (!paintCanvas || !overlayCanvas) return;

      const width = video?.videoWidth || 1280;
      const height = video?.videoHeight || 720;

      paintCanvas.width = width;
      paintCanvas.height = height;
      overlayCanvas.width = width;
      overlayCanvas.height = height;
    }

    window.addEventListener("resize", syncCanvas);
    syncCanvas();

    return () => window.removeEventListener("resize", syncCanvas);
  }, []);

  useEffect(() => {
    colorRef.current = color;
    sizeRef.current = size;
  }, [color, size]);

  useEffect(() => {
    const hands = new Hands({
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

      const indexTip = landmarks[8];
      const thumbTip = landmarks[4];
      const handSize = distance(landmarks[0], landmarks[9]);
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

      const point = {
        x: (1 - indexTip.x) * paintCanvas.width,
        y: indexTip.y * paintCanvas.height
      };

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

    return () => {
      hands.close();
      handsRef.current = null;
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
      const camera = new Camera(video, {
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
