import React, { useRef, useState, useEffect, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Stars, OrbitControls, Trail, Html } from '@react-three/drei';
import * as THREE from 'three';

interface PlanetParams {
    name: string;
    ae: number;
    so: number;
    sof: number;
    lof: number;
    he: number;
    ad: number;
    parent: string;
    color: string;
    textureUrl: string;
}

const PLANETS: PlanetParams[] = [
    { name: "Solen",   ae: 0,        so: 0,         sof: 0,     lof: 0,     he: 0,     ad: 5.0,   parent: "NULL",   color: "yellow",    textureUrl: "/textures/planets/sun.jpg" },
    { name: "Merkur",  ae: 3.87,     so: 87.969,    sof: 0.331, lof: 0.843, he: 7.00,  ad: 0.382, parent: "Solen",  color: "lightcoral", textureUrl: "/textures/planets/mercury.jpg" },
    { name: "Venus",   ae: 7.23,     so: 224.701,   sof: 6.206, lof: 1.337, he: 3.39,  ad: 0.948, parent: "Solen",  color: "cyan",       textureUrl: "/textures/planets/venus.jpg" },
    { name: "Jorden",  ae: 10.00,    so: 365.256,   sof: 1.693, lof: 0,     he: 0,     ad: 1.000, parent: "Solen",  color: "royalblue",  textureUrl: "/textures/planets/earth.jpg" },
    { name: "Maanen",  ae: 1.5,      so: 27.300,    sof: 0,     lof: 0,     he: 5.14,  ad: 0.272, parent: "Jorden", color: "lightgray",  textureUrl: "/textures/planets/moon.jpg" },
    { name: "Mars",    ae: 15.23,    so: 686.980,   sof: 5.375, lof: 0.864, he: 1.85,  ad: 0.532, parent: "Solen",  color: "red",        textureUrl: "/textures/planets/mars.jpg" },
    { name: "Jupiter", ae: 52.02,    so: 4332.590,  sof: 4.758, lof: 1.753, he: 1.30,  ad: 11.19, parent: "Solen",  color: "orange",     textureUrl: "/textures/planets/jupiter.jpg" },
    { name: "Saturn",  ae: 95.38,    so: 10759.200, sof: 0.015, lof: 1.983, he: 2.49,  ad: 9.40,  parent: "Solen",  color: "khaki",      textureUrl: "/textures/planets/saturn.jpg" },
    { name: "Uranus",  ae: 191.80,   so: 30684.800, sof: 5.165, lof: 1.293, he: 0.77,  ad: 4.10,  parent: "Solen",  color: "lightcyan",  textureUrl: "/textures/planets/uranus.jpg" },
    { name: "Neptun",  ae: 300.58,   so: 60190.500, sof: 5.166, lof: 2.286, he: 1.77,  ad: 3.88,  parent: "Solen",  color: "lightblue",  textureUrl: "/textures/planets/neptune.jpg" },
    { name: "Pluto",   ae: 394.40,   so: 90465.000, sof: 4.070, lof: 1.926, he: 17.20, ad: 0.17,  parent: "Solen",  color: "lightgreen", textureUrl: "/textures/planets/pluto.jpg" },
];

const SLIDER_MIN = 0;
const SLIDER_MAX = 100;

// speedFactor = simulated days per real second
// slider=0  → 1000 days/sec  (1/1000 sec = 1 day)
// slider=100 → 1/86400 days/sec (real time, 86400 sec = 1 day)
function sliderToSpeed(v: number): number {
    return 1000 * Math.pow(86_400_000, -v / SLIDER_MAX);
}

function speedToLabel(s: number): string {
    if (s >= 1) return `${Math.round(s).toLocaleString()} dage/sek`;
    const secPerDay = 1 / s;
    if (secPerDay >= 86_000) return 'Realtid';
    return `1 dag = ${Math.round(secPerDay).toLocaleString()} sek`;
}

// Computes heliocentric position of Earth at time t (used by Sun light + geocentric correction)
function earthPos(t: number): [number, number, number] {
    const jorden = PLANETS.find(p => p.name === "Jorden")!;
    const wJ = (2 * Math.PI) / jorden.so;
    return [
        jorden.ae * Math.cos(wJ * t + jorden.lof),
        Math.tan(jorden.he * (Math.PI / 180)) * Math.sin(wJ * t - jorden.sof),
        jorden.ae * Math.sin(wJ * t + jorden.lof),
    ];
}

const EYE_SEPARATION = 8;

interface CameraState { pos: THREE.Vector3; quat: THREE.Quaternion }

// ── Stereo camera helpers ────────────────────────────────────────────────────

const CameraWriter = ({ stateRef }: { stateRef: { current: CameraState } }) => {
    const { camera } = useThree();
    useFrame(() => {
        stateRef.current.pos.copy(camera.position);
        stateRef.current.quat.copy(camera.quaternion);
    });
    return null;
};

const CameraReader = ({ stateRef }: { stateRef: { current: CameraState } }) => {
    const { camera } = useThree();
    useFrame(() => {
        camera.position.copy(stateRef.current.pos);
        camera.quaternion.copy(stateRef.current.quat);
        const right = new THREE.Vector3(1, 0, 0).applyQuaternion(stateRef.current.quat);
        camera.position.addScaledVector(right, EYE_SEPARATION);
        camera.updateMatrixWorld();
    });
    return null;
};

// ── Sun light that always follows the Sun's world position ───────────────────

interface SunLightProps {
    isGeocentric: boolean;
    speedFactor: number;
    clockOffsetRef: { current: number };
    elapsedRef: { current: number };
}

const SunLight = ({ isGeocentric, speedFactor, clockOffsetRef, elapsedRef }: SunLightProps) => {
    const lightRef = useRef<THREE.PointLight>(null!);

    useFrame((state) => {
        elapsedRef.current = state.clock.getElapsedTime();
        const t = (elapsedRef.current - clockOffsetRef.current) * speedFactor;

        if (!isGeocentric) {
            lightRef.current.position.set(0, 0, 0);
        } else {
            // In geocentric, Sun is at −(Earth's heliocentric position)
            const [ex, ey, ez] = earthPos(t);
            lightRef.current.position.set(-ex, -ey, -ez);
        }
    });

    return <pointLight ref={lightRef} intensity={2000} distance={2000} decay={1} />;
};

// ── Planet ───────────────────────────────────────────────────────────────────

interface PlanetInstanceProps {
    data: PlanetParams;
    isGeocentric: boolean;
    showTrails: boolean;
    showLabels: boolean;
    speedFactor: number;
    clockOffsetRef: { current: number };
}

const PlanetInstance = ({ data, isGeocentric, showTrails, showLabels, speedFactor, clockOffsetRef }: PlanetInstanceProps) => {
    const meshRef = useRef<THREE.Mesh>(null!);
    const [texture, setTexture] = useState<THREE.Texture | null>(null);

    useEffect(() => {
        const loader = new THREE.TextureLoader();
        loader.load(data.textureUrl, setTexture, undefined, () => setTexture(null));
    }, [data.textureUrl]);

    useFrame((state) => {
        const t = (state.clock.getElapsedTime() - clockOffsetRef.current) * speedFactor;

        // Sun: fixed at origin (heliocentric) or at −Earth (geocentric)
        if (data.name === "Solen") {
            if (!isGeocentric) return;
            const [ex, ey, ez] = earthPos(t);
            meshRef.current.position.set(-ex, -ey, -ez);
            meshRef.current.rotation.y += 0.005;
            return;
        }

        const w = (2 * Math.PI) / data.so;
        let x = data.ae * Math.cos(w * t + data.lof);
        let z = data.ae * Math.sin(w * t + data.lof);
        let y = Math.tan(data.he * (Math.PI / 180)) * Math.sin(w * t - data.sof);

        // Add parent body's position (e.g. Moon follows Earth)
        if (data.parent !== "Solen" && data.parent !== "NULL") {
            const parent = PLANETS.find(p => p.name === data.parent)!;
            const pw = (2 * Math.PI) / parent.so;
            x += parent.ae * Math.cos(pw * t + parent.lof);
            z += parent.ae * Math.sin(pw * t + parent.lof);
            y += Math.tan(parent.he * (Math.PI / 180)) * Math.sin(pw * t - parent.sof);
        }

        // Geocentric: subtract Earth's heliocentric position from everyone
        if (isGeocentric) {
            if (data.name === "Jorden") {
                x = 0; y = 0; z = 0;
            } else {
                const [ex, ey, ez] = earthPos(t);
                x -= ex; y -= ey; z -= ez;
            }
        }

        meshRef.current.position.set(x, y, z);
        meshRef.current.rotation.y += 0.01;
    });

    const mesh = (
        <mesh ref={meshRef}>
            <sphereGeometry args={[data.ad * 0.5, 64, 64]} />
            <meshStandardMaterial
                map={texture ?? undefined}
                color={texture ? "white" : data.color}
                emissive={data.name === "Solen" ? data.color : "black"}
                emissiveIntensity={data.name === "Solen" ? 1 : 0}
            />
            {showLabels && (
                <Html distanceFactor={20}>
                    <div style={{ color: 'white', fontSize: '10px', pointerEvents: 'none' }}>{data.name}</div>
                </Html>
            )}
        </mesh>
    );

    return showTrails
        ? <Trail width={1} color={data.color} length={50} decay={1}>{mesh}</Trail>
        : mesh;
};

// ── Camera angle control (only in master canvas) ─────────────────────────────

const CameraAngleControl = ({ angle, controlsRef }: { angle: number; controlsRef: { current: any } }) => {
    const { camera } = useThree();

    useEffect(() => {
        const controls = controlsRef.current;
        if (!controls) return;
        const target: THREE.Vector3 = controls.target;
        const offset = camera.position.clone().sub(target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        // phi = polar angle: 0 = top, PI/2 = side, PI = bottom
        spherical.phi = THREE.MathUtils.degToRad(Math.max(1, Math.min(179, angle)));
        spherical.makeSafe();
        camera.position.copy(new THREE.Vector3().setFromSpherical(spherical).add(target));
        camera.lookAt(target);
        controls.update();
    }, [angle]); // eslint-disable-line react-hooks/exhaustive-deps

    return null;
};

// ── Scene ────────────────────────────────────────────────────────────────────

interface SceneProps {
    isGeocentric: boolean;
    showTrails: boolean;
    showLabels: boolean;
    speedFactor: number;
    cameraAngle: number;
    isMaster: boolean;
    cameraStateRef: { current: CameraState };
    clockOffsetRef: { current: number };
    elapsedRef: { current: number };
    resetSignal: number;
}

const Scene = ({
    isGeocentric, showTrails, showLabels, speedFactor, cameraAngle,
    isMaster, cameraStateRef, clockOffsetRef, elapsedRef, resetSignal,
}: SceneProps) => {
    const controlsRef = useRef<any>(null);

    useEffect(() => {
        if (isMaster && controlsRef.current) controlsRef.current.reset();
    }, [resetSignal, isMaster]);

    return (
        <>
            <Stars radius={300} depth={60} count={20000} factor={7} saturation={0} fade speed={1} />
            <ambientLight intensity={0.08} />
            <SunLight
                isGeocentric={isGeocentric}
                speedFactor={speedFactor}
                clockOffsetRef={clockOffsetRef}
                elapsedRef={elapsedRef}
            />

            {PLANETS.map(p => (
                <PlanetInstance
                    key={p.name}
                    data={p}
                    isGeocentric={isGeocentric}
                    showTrails={showTrails}
                    showLabels={isMaster && showLabels}
                    speedFactor={speedFactor}
                    clockOffsetRef={clockOffsetRef}
                />
            ))}

            {isMaster
                ? <>
                    <OrbitControls makeDefault ref={controlsRef} />
                    <CameraAngleControl angle={cameraAngle} controlsRef={controlsRef} />
                    <CameraWriter stateRef={cameraStateRef} />
                  </>
                : <CameraReader stateRef={cameraStateRef} />
            }
        </>
    );
};

// ── App ───────────────────────────────────────────────────────────────────────

const btnStyle: React.CSSProperties = {
    padding: '6px 14px',
    background: 'rgba(255,255,255,0.1)',
    color: 'white',
    border: '1px solid rgba(255,255,255,0.3)',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    whiteSpace: 'nowrap',
};

export default function App() {
    const [geocentric, setGeocentric] = useState(false);
    const [stereo, setStereo] = useState(false);
    const [showTrails, setShowTrails] = useState(false);
    const [showLabels, setShowLabels] = useState(true);
    const [sliderVal, setSliderVal] = useState(25);
    const [cameraAngle, setCameraAngle] = useState(75); // degrees: 0=top, 90=side, 180=bottom
    const [resetSignal, setResetSignal] = useState(0);

    const clockOffsetRef = useRef(0);
    const elapsedRef = useRef(0);
    const cameraStateRef = useRef<CameraState>({
        pos: new THREE.Vector3(0, 50, 150),
        quat: new THREE.Quaternion(),
    });

    const speedFactor = sliderToSpeed(sliderVal);

    const handleReset = () => {
        clockOffsetRef.current = elapsedRef.current; // reset simulation time to 0
        setResetSignal(s => s + 1);                  // trigger camera reset
    };

    return (
        <div style={{ width: '100vw', height: '100vh', background: 'black', color: 'white' }}>
            <div style={{
                position: 'absolute', zIndex: 10, padding: '10px 16px',
                display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap',
                background: 'rgba(0,0,0,0.55)', width: '100%', boxSizing: 'border-box',
            }}>
                <button style={btnStyle} onClick={() => setGeocentric(g => !g)}>
                    {geocentric ? 'Geocentrisk' : 'Heliocentrisk'}
                </button>
                <button style={btnStyle} onClick={() => setStereo(s => !s)}>
                    Stereo: {stereo ? 'ON' : 'OFF'}
                </button>
                <button style={btnStyle} onClick={() => setShowTrails(t => !t)}>
                    Baner: {showTrails ? 'ON' : 'OFF'}
                </button>
                <button style={btnStyle} onClick={() => setShowLabels(l => !l)}>
                    Labels: {showLabels ? 'ON' : 'OFF'}
                </button>
                <button
                    style={{ ...btnStyle, borderColor: 'rgba(255,200,80,0.5)', color: '#ffd080' }}
                    onClick={handleReset}
                >
                    Reset
                </button>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '4px' }}>
                    <span style={{ fontSize: '11px', opacity: 0.6 }}>Top (0°)</span>
                    <input
                        type="range"
                        min={0}
                        max={180}
                        value={cameraAngle}
                        onChange={e => setCameraAngle(Number(e.target.value))}
                        style={{ width: '120px', accentColor: 'white' }}
                    />
                    <span style={{ fontSize: '11px', opacity: 0.6 }}>Bund (180°)</span>
                    <span style={{
                        fontSize: '12px', color: '#adf', minWidth: '48px',
                        background: 'rgba(255,255,255,0.08)', padding: '3px 8px', borderRadius: '4px',
                    }}>
                        {cameraAngle}°
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginLeft: '4px' }}>
                    <span style={{ fontSize: '11px', opacity: 0.6 }}>1/1000 sek=1dag</span>
                    <input
                        type="range"
                        min={SLIDER_MIN}
                        max={SLIDER_MAX}
                        value={sliderVal}
                        onChange={e => setSliderVal(Number(e.target.value))}
                        style={{ width: '140px', accentColor: 'white' }}
                    />
                    <span style={{ fontSize: '11px', opacity: 0.6 }}>Realtid</span>
                    <span style={{
                        fontSize: '12px', color: '#adf', minWidth: '160px',
                        background: 'rgba(255,255,255,0.08)', padding: '3px 8px', borderRadius: '4px',
                    }}>
                        {speedToLabel(speedFactor)}
                    </span>
                </div>
            </div>

            <div style={{ display: 'flex', width: '100%', height: '100%', paddingTop: '46px', boxSizing: 'border-box' }}>
                <Canvas camera={{ position: [0, 50, 150], fov: 45 }}>
                    <Suspense fallback={null}>
                        <Scene
                            isGeocentric={geocentric}
                            showTrails={showTrails}
                            showLabels={showLabels}
                            speedFactor={speedFactor}
                            cameraAngle={cameraAngle}
                            isMaster={true}
                            cameraStateRef={cameraStateRef}
                            clockOffsetRef={clockOffsetRef}
                            elapsedRef={elapsedRef}
                            resetSignal={resetSignal}
                        />
                    </Suspense>
                </Canvas>

                {stereo && (
                    <Canvas camera={{ position: [EYE_SEPARATION, 50, 150], fov: 45 }}>
                        <Suspense fallback={null}>
                            <Scene
                                isGeocentric={geocentric}
                                showTrails={showTrails}
                                showLabels={false}
                                speedFactor={speedFactor}
                                cameraAngle={cameraAngle}
                                isMaster={false}
                                cameraStateRef={cameraStateRef}
                                clockOffsetRef={clockOffsetRef}
                                elapsedRef={elapsedRef}
                                resetSignal={resetSignal}
                            />
                        </Suspense>
                    </Canvas>
                )}
            </div>
        </div>
    );
}
