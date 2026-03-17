import * as THREE from 'three';
import { Vector2, Vector3 } from 'three';
import { OrbitControls, GLTFLoader, BufferGeometryUtils, EffectComposer, ShaderPass, HorizontalBlurShader, VerticalBlurShader } from 'three/examples/jsm/Addons.js'
import { computeBoundsTree, disposeBoundsTree, MeshBVHUniformStruct, BVHShaderGLSL } from 'three-mesh-bvh';

const { mergeGeometries } = BufferGeometryUtils
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;

let width = window.innerWidth;
let height = window.innerHeight;
let aspect = width / height;
const dpr = window.devicePixelRatio;
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(dpr)
renderer.setSize(width, height);
renderer.setAnimationLoop((time) => {
	renderer.render(scene, camera);
});
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, width / height, 0.1, 100);
camera.position.set(0, 0, 1);
const controls = new OrbitControls(camera, renderer.domElement);

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
})('melody-rotated');
geometry.computeBoundingSphere()
const scaleFactor = 1 / geometry.boundingSphere.radius
geometry.scale(scaleFactor, scaleFactor, scaleFactor)
geometry.computeVertexNormals()
geometry.computeBoundsTree();
const material = new THREE.MeshStandardMaterial();
const mesh = new THREE.Mesh(geometry, material);
scene.add(mesh);
const bbox = mesh.geometry.boundingBox
const AOPlanePosition = new Vector3((bbox.min.x + bbox.max.x) / 2, bbox.min.y - 0.1, (bbox.min.z + bbox.max.z) / 2)
const maxExtend = Math.max(bbox.max.x - bbox.min.x, bbox.max.z - bbox.min.z)
const AOPlaneSize = new Vector2(maxExtend * 3, maxExtend * 3)

scene.add(new THREE.DirectionalLight(0xffffff, 1))
scene.add(new THREE.AmbientLight(0xffffff, 0.1))

const aoTextureWidth = 256
const aoTextureHeight = 256
const dataTextureWidth = 128

async function loadDataTexture(url) {
	const buffer = await (await fetch(url)).arrayBuffer();

	const data = new Uint8Array(buffer);

	const sobol = new THREE.DataTexture(
		data.slice(0, 256 * 256),
		dataTextureWidth,
		256 * 256 / dataTextureWidth,
		THREE.RedIntegerFormat,
		THREE.UnsignedByteType, 
		THREE.UVMapping, 
		THREE.ClampToEdgeWrapping, 
		THREE.ClampToEdgeWrapping, 
		THREE.NearestFilter, 
		THREE.NearestFilter
	);
	const tile = new THREE.DataTexture(
		data.slice(256 * 256, 256 * 256 + 128 * 128 * 8),
		dataTextureWidth,
		128 * 128 * 8 / dataTextureWidth,
		THREE.RedIntegerFormat,
		THREE.UnsignedByteType, 
		THREE.UVMapping, 
		THREE.ClampToEdgeWrapping, 
		THREE.ClampToEdgeWrapping, 
		THREE.NearestFilter, 
		THREE.NearestFilter
	);
	const ranking = new THREE.DataTexture(
		data.slice(256 * 256 + 128 * 128 * 8),
		dataTextureWidth,
		128 * 128 * 8 / dataTextureWidth,
		THREE.RedIntegerFormat,
		THREE.UnsignedByteType, 
		THREE.UVMapping, 
		THREE.ClampToEdgeWrapping, 
		THREE.ClampToEdgeWrapping, 
		THREE.NearestFilter, 
		THREE.NearestFilter
	);

	return [sobol, tile, ranking];
}
const [sobolTex, sobolTileTex,sobolRankingTex]  = await loadDataTexture('/public/sobol.bin')

const renderTarget = new THREE.WebGLRenderTarget(aoTextureWidth, aoTextureHeight, {
	depthBuffer: false,
	stencilBuffer: false
});
renderTarget.texture.magFilter = THREE.LinearFilter
renderTarget.texture.colorSpace = THREE.NoColorSpace
const composer = new EffectComposer(renderer, renderTarget);
composer.renderToScreen = false
const aoPass = new ShaderPass({
	glslVersion: THREE.GLSL3,
	defines: {
	},
	uniforms: {
		bvh: { value: new MeshBVHUniformStruct() },
		AOPlanePosition: { value: AOPlanePosition },
		AOPlaneSize: { value: AOPlaneSize },
		sobolTex: { value: sobolTex },
		sobolTileTex: { value: sobolTileTex },
		sobolRankingTex: { value: sobolRankingTex },
	},
	vertexShader: `
			out vec2 vUv;
			void main() {
				gl_Position = vec4(position, 1);
				vUv = uv;
			}
		`,

	fragmentShader: `
			${BVHShaderGLSL.common_functions}
			${BVHShaderGLSL.bvh_struct_definitions}
			${BVHShaderGLSL.bvh_ray_functions}
			uniform BVH bvh;
			uniform vec3 AOPlanePosition;
			uniform vec2 AOPlaneSize;
			uniform usampler2D sobolTex;
			uniform usampler2D sobolTileTex;
			uniform usampler2D sobolRankingTex;

			in vec2 vUv;

			const float PI = 3.14159216;
			vec3 sampleCosineHemisphere(float u0, float u1) {
				float r = sqrt(u0);
				float theta = u1 * PI * 2.;
				return vec3(r * cos(theta), sqrt(1. - r * r), r * sin(theta));
			}

			int sobol(int i) {
				return int(texelFetch(sobolTex, ivec2(i % ${dataTextureWidth}, i / ${dataTextureWidth}), 0).x);
			}
			int sobolTile(int i) {
				return int(texelFetch(sobolTileTex, ivec2(i % ${dataTextureWidth}, i / ${dataTextureWidth}), 0).x);
			}
			int sobolRanking(int i) {
				return int(texelFetch(sobolRankingTex, ivec2(i % ${dataTextureWidth}, i / ${dataTextureWidth}), 0).x);
			}
			float bluenoise(int pixel_i, int pixel_j, int sampleIndex, int sampleDimension) {
				pixel_i = pixel_i & 127;
				pixel_j = pixel_j & 127;

				// xor index based on optimized ranking
				int rankedSampleIndex = sampleIndex ^ sobolTile((sampleDimension + (pixel_i + pixel_j*128)*8) % (128 * 128 * 8));

				// fetch value in sequence
				int value = sobol(sampleDimension + rankedSampleIndex*256);

				// If the dimension is optimized, xor sequence value based on optimized scrambling
				value = value ^ sobolRanking((sampleDimension%8) + (pixel_i + pixel_j*128)*8);

				return (0.5f+float(value))/256.0f;
			}
	
			uvec3 pcg3d(uvec3 v) {
				v = v * 1664525u + 1013904223u;
				v.x += v.y*v.z;
				v.y += v.z*v.x;
				v.z += v.x*v.y;
				v = v ^ (v>>16u);
				v.x += v.y*v.z;
				v.y += v.z*v.x;
				v.z += v.x*v.y;
				return v;
			}

			void main() {
			vec3 p = AOPlanePosition;
			p.x += (vUv.x - 0.5) * AOPlaneSize.x;
			p.z += (vUv.y - 0.5) * AOPlaneSize.y;

			uvec4 faceIndices = uvec4( 0u );
			vec3 faceNormal = vec3( 0.0, 0.0, 1.0 );
			vec3 barycoord = vec3( 0.0 );
			float side = 1.0;
			float dist = 0.0;

			const int nsamples = 32;
			int hits = 0;
			for(int i = 0; i < nsamples; i++) {
			float u0 = bluenoise(int(gl_FragCoord.x), int(gl_FragCoord.y), i, 0);
			float u1 = bluenoise(int(gl_FragCoord.x), int(gl_FragCoord.y), i, 1);
				if(bvhIntersectFirstHit( bvh, p, sampleCosineHemisphere(u0, u1), faceIndices, faceNormal, barycoord, side, dist ))
					hits += 1;
			}

			float ao = 1. - float(hits) / float(nsamples);
			gl_FragColor = vec4(ao, ao, ao, 1);
			}
		`

})
const hBlur = new ShaderPass(HorizontalBlurShader);
const vBlur = new ShaderPass(VerticalBlurShader);
aoPass.uniforms.bvh.value.updateFrom(geometry.boundsTree);
hBlur.uniforms.h.value = 1 / aoTextureWidth;
vBlur.uniforms.v.value = 1 / aoTextureHeight;
composer.addPass(aoPass);
composer.addPass(hBlur);
composer.addPass(vBlur);

const t0 = performance.now();
composer.render()
renderer.getContext().finish()
const t1 = performance.now();

console.log('AO computed in:', t1 - t0, 'ms');

const plane = new THREE.Mesh(new THREE.PlaneGeometry(AOPlaneSize.x, AOPlaneSize.y), new THREE.MeshBasicMaterial({
	map: composer.readBuffer.texture,
	side: THREE.DoubleSide
}))
plane.rotateX(Math.PI / 2)
plane.position.copy(AOPlanePosition)
scene.add(plane)