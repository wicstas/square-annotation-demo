import * as THREE from 'three';
import { Vector2, Vector3 } from 'three';
import { OrbitControls, GLTFLoader, BufferGeometryUtils } from 'three/examples/jsm/Addons.js'
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast, } from 'three-mesh-bvh';

const { mergeGeometries } = BufferGeometryUtils

function add(a, b, ...args) {
	let result = a.clone().add(b);
	for (const x of args)
		result.add(x);
	return result;
}
function sub(a, b) {
	return a.clone().sub(b);
}
function cross(a, b) {
	return a.clone().cross(b);
}
function dot(a, b) {
	return a.dot(b);
}
function mul(a, b) {
	if (typeof b === 'number')
		return a.clone().multiplyScalar(b);
	else
		return a.clone().multiply(b);
}
function neg(a) {
	return a.clone().negate();
}
// Project x onto v
function proj(v, x) {
	return mul(v, v.dot(x));
}
function lerp(x, y, t) {
	if (typeof x === 'number' && typeof y === 'number')
		return (1 - t) * x + t * y;
	else
		return x.clone().lerp(y, t);
}
function coordinateSystem(n, up) {
	if (up === undefined)
		up = Math.abs(n.y) < 0.9
			? new Vector3(0, 1, 0)
			: new Vector3(1, 0, 0);

	const x = new Vector3().crossVectors(up, n).normalize();

	const y = new Vector3().crossVectors(n, x).normalize();

	return [x, y, n.clone()]
}
function sampleDisk(u0, u1) {
	const r = Math.sqrt(u0)
	const theta = u1 * Math.PI * 2
	return new Vector2(r * Math.cos(theta), r * Math.sin(theta))
}
function sampleHemisphere(z, u1) {
	const theta = u1 * Math.PI * 2
	const base = Math.sqrt(1 - z * z)
	return new Vector3(base * Math.cos(theta), z, base * Math.sin(theta))
}
function sampleCosineWeightedHemisphere(u0, u1) {
	const r = Math.sqrt(u0)
	const theta = u1 * Math.PI * 2
	return new Vector3(r * Math.cos(theta), Math.sqrt(1 - r * r), r * Math.sin(theta))
}

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

let width = window.innerWidth;
let height = window.innerHeight;
let aspect = width / height;
const dpr = window.devicePixelRatio;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 100);
camera.position.set(0, 0, 1);

const geometry = await (async (name) => {
	if (name == 'knot')
		return new THREE.TorusKnotGeometry(1, 0.3, 100, 16);
	if (name == 'torus')
		return new THREE.TorusGeometry(2, 1, 32)
	if (name == 'capsule')
		return new THREE.CapsuleGeometry(1, 1, 30, 40, 1);

	const loader = new GLTFLoader();
	const gltf = await loader.loadAsync(`/public/${name}.glb`);
	const geometries = [];
	gltf.scene.traverse((obj) => {
		if (obj.isMesh) {
			const geom = obj.geometry.clone();
			geom.applyMatrix4(obj.matrixWorld);
			geometries.push(geom);
		}
	});
	return mergeGeometries(
		geometries,
		false
	);
})('bunny');
geometry.computeBoundingSphere()
const scaleFactor = 1 / geometry.boundingSphere.radius
geometry.scale(scaleFactor, scaleFactor, scaleFactor)
geometry.computeVertexNormals()
geometry.computeBoundsTree();
const material = new THREE.MeshStandardMaterial();
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);

const ambientLight = new THREE.AmbientLight(0xffffff, 1);
scene.add(ambientLight)

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(dpr)
renderer.setSize(width, height);
renderer.setAnimationLoop((time) => {
	renderer.render(scene, camera);
});
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
const raycaster = new THREE.Raycaster();
raycaster.firstHitOnly = true

let cosineWeighted = false

const computeAO = (p) => {
	const nsamples = 100
	let hits = 0

	for (let i = 0; i < nsamples; i++) {
		const w = (cosineWeighted ? sampleCosineWeightedHemisphere : sampleHemisphere)(Math.random(), Math.random())
		raycaster.set(p, w)
		if (raycaster.intersectObject(mesh, false).length > 0)
			hits++
	}

	return hits / nsamples
}
const bakeAO = () => {
	for (let y = 0; y < aoTextureHeight; y++) {
		for (let x = 0; x < aoTextureWidth; x++) {
			const i = (y * aoTextureWidth + x) * 4
			const p = position.clone()
			p.x += (x / aoTextureWidth - 0.5) * size.x
			p.z += (y / aoTextureHeight - 0.5) * size.y
			const ao = computeAO(p)
			data[i + 0] = 255.99 * (1 - ao)
			data[i + 1] = 255.99 * (1 - ao)
			data[i + 2] = 255.99 * (1 - ao)
			data[i + 3] = 255
		}
	}
}

const position = new Vector3(0, mesh.geometry.boundingBox.min.y, 0)
const size = new Vector2(5, 5)

const aoTextureWidth = 64
const aoTextureHeight = 64
const data = new Uint8Array(4 * aoTextureWidth * aoTextureHeight)
bakeAO()

const texture = new THREE.DataTexture(
	data,
	aoTextureWidth,
	aoTextureHeight,
	THREE.RGBAFormat, THREE.UnsignedByteType
)
texture.wrapS = THREE.ClampToEdgeWrapping
texture.wrapT = THREE.ClampToEdgeWrapping
texture.magFilter = THREE.NearestFilter
texture.minFilter = THREE.NearestFilter
texture.colorSpace = THREE.NoColorSpace
texture.generateMipmaps = false
texture.needsUpdate = true
const plane = new THREE.Mesh(new THREE.PlaneGeometry(size.x, size.y), new THREE.MeshBasicMaterial({
	map: texture,
	side: THREE.DoubleSide
}))
plane.rotateX(Math.PI / 2)
plane.position.copy(position)
scene.add(plane)


document.getElementById('cosineWeighted').addEventListener('pointerdown', () => {
	cosineWeighted = !cosineWeighted
	document.getElementById('cosineWeighted').classList.toggle('pressed', cosineWeighted)
	bakeAO()
	texture.needsUpdate = true
})