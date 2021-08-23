function instantiateGltf(gltfRoot, scene) {
    const node = new BABYLON.TransformNode("instanceNode", scene);
    gltfRoot.getChildren(function (child) { return child.name !== node.name; }, true).forEach(function (child) {
        child.createInstance("").parent = node;
    });
    node.parent = gltfRoot;
    return node;
}

function thinInstantiateGltf(gltfRoot, translation, rotation) {
    const matrix = BABYLON.Matrix.RotationY(rotation);
    matrix.m[12] = translation.x;
    matrix.m[13] = translation.y;
    matrix.m[14] = translation.z;
    gltfRoot.getChildren(function (child) { return true; }, true).forEach(function (child) {
        child.thinInstanceAdd(matrix);
    });
}

function getAnimationNulls(mesh, handedness) {
    const name = handedness === "right" ? "root_R" : "root_L";
    return mesh.getChildren(function (child) { return child.name === name; }, true)[0].getChildren();
}

class Avatar {
    _scene;
    _mesh;
    _audioStream;

    _startedLoadingHandMeshes = false;
    _leftHandMesh;
    _rightHandMesh;

    constructor (scene) {
        this._scene = scene;

        this._mesh = new BABYLON.TransformNode("", this._scene);
        this._mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
        this._loadHeadMeshAsync().then((mesh) => {
            mesh.parent = this._mesh;
        });
    }

    setAudioStream(stream) {
        this._audioStream = new BABYLON.Sound("audioStream", stream, this._scene, null, { autoplay: true });
        this._audioStream.attachToMesh(this._mesh);
    }

    update(data) {
        const participantData = JSON.parse(data);

        if (this._mesh) {
            this._mesh.position.x = participantData.camera.px;
            this._mesh.position.y = participantData.camera.py;
            this._mesh.position.z = participantData.camera.pz;
            this._mesh.rotationQuaternion.x = participantData.camera.rx;
            this._mesh.rotationQuaternion.y = participantData.camera.ry;
            this._mesh.rotationQuaternion.z = participantData.camera.rz;
            this._mesh.rotationQuaternion.w = participantData.camera.rw;
        }

        if (participantData.hands) {
            if (!this._startedLoadingHandMeshes) {
                this._loadHandMeshesAsync();
                this._startedLoadingHandMeshes = true;
            }

            if (participantData.hands["left"] && this._leftHandMesh) {
                this._updateHandMesh(participantData.hands["left"], this._leftHandMesh, "left");
            }
            if (participantData.hands["right"] && this._rightHandMesh) {
                this._updateHandMesh(participantData.hands["right"], this._rightHandMesh, "right");
            }
        }
    }

    _updateHandMesh(data, handMesh, handedness) {
        const children = getAnimationNulls(handMesh, handedness);
        for (let idx = 0; idx < children.length; ++idx) {
            children[idx].position.x = data.joints[idx][0];
            children[idx].position.y = data.joints[idx][1];
            children[idx].position.z = data.joints[idx][2];
            children[idx].rotationQuaternion.x = data.joints[idx][3];
            children[idx].rotationQuaternion.y = data.joints[idx][4];
            children[idx].rotationQuaternion.z = data.joints[idx][5];
            children[idx].rotationQuaternion.w = data.joints[idx][6];
        }
    }

    dispose() {
        if (this._audioStream) {
            this._audioStream.dispose();
        }
        this._mesh.dispose();
        if (this._leftHandMesh) {
            this._leftHandMesh.dispose();
        }
        if (this._rightHandMesh) {
            this._rightHandMesh.dispose();
        }
    }

    async _loadHeadMeshAsync() {
        const loaded = await BABYLON.SceneLoader.ImportMeshAsync("", "/assets/custom/", "lon.glb", this._scene);
        const root = loaded.meshes[0];
        root.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(-Math.PI / 2, Math.PI, 0);
        root.scaling.scaleInPlace(0.7);
        loaded.animationGroups.forEach(function (group) {
            group.loopAnimation = true;
            group.play();
        });
        return root;
    }

    async _loadHandMeshesAsync() {
        const ROOT_URL_PATH = "https://assets.babylonjs.com/meshes/HandMeshes/";
        const LEFT_HAND_GLB = "l_hand_lhs.glb";
        const RIGHT_HAND_GLB = "r_hand_lhs.glb";
        const leftLoaded = await BABYLON.SceneLoader.ImportMeshAsync("", ROOT_URL_PATH, LEFT_HAND_GLB, this._scene);
        const rightLoaded = await BABYLON.SceneLoader.ImportMeshAsync("", ROOT_URL_PATH, RIGHT_HAND_GLB, this._scene);
        // shader
        const handColors = {
            base: BABYLON.Color3.FromInts(116, 63, 203),
            fresnel: BABYLON.Color3.FromInts(149, 102, 229),
            fingerColor: BABYLON.Color3.FromInts(177, 130, 255),
            tipFresnel: BABYLON.Color3.FromInts(220, 200, 255),
        };

        const createMaterial = async function (scene) {
            const handShader = new BABYLON.NodeMaterial("leftHandShader", scene, { emitComments: false });
            await handShader.loadAsync("https://assets.babylonjs.com/meshes/HandMeshes/handsShader.json");
            // build node materials
            handShader.build(false);

            // depth prepass and alpha mode
            handShader.needDepthPrePass = true;
            handShader.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
            handShader.alphaMode = BABYLON.Engine.ALPHA_COMBINE;

            const handNodes = {
                base: handShader.getBlockByName("baseColor"),
                fresnel: handShader.getBlockByName("fresnelColor"),
                fingerColor: handShader.getBlockByName("fingerColor"),
                tipFresnel: handShader.getBlockByName("tipFresnelColor"),
            };

            handNodes.base.value = handColors.base;
            handNodes.fresnel.value = handColors.fresnel;
            handNodes.fingerColor.value = handColors.fingerColor;
            handNodes.tipFresnel.value = handColors.tipFresnel;

            return handShader;
        }

        leftLoaded.meshes[1].material = await createMaterial(this._scene);
        leftLoaded.meshes[1].alwaysSelectAsActiveMesh = true;

        rightLoaded.meshes[1].material = await createMaterial(this._scene);
        rightLoaded.meshes[1].alwaysSelectAsActiveMesh = true;

        // Rename all the animation nulls to avoid conflicting with Babylon.js's internal logic.
        leftLoaded.meshes[0].getChildren(function () { return true; }, false).forEach(function (child) {
            if (child.name !== "root_L") {
                child.name = "";
            }
        });
        rightLoaded.meshes[0].getChildren(function () { return true; }, false).forEach(function (child) {
            if (child.name !== "root_R") {
                child.name = "";
            }
        });

        this._leftHandMesh = leftLoaded.meshes[0];
        this._rightHandMesh = rightLoaded.meshes[0];

        // Rotate to account for what Babylon is doing with the hands.
        const parent = new BABYLON.TransformNode("", this._scene);
        parent.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(0, Math.PI, 0);
        this._leftHandMesh.parent = parent;
        this._rightHandMesh.parent = parent;
    }
}

class BabylonExperience {
    participantDataUpdatedObservable = new BABYLON.Observable();

    _engine;
    _scene;
    _participantData = {};
    
    constructor (canvas) {
        this._engine = new BABYLON.Engine(canvas);
        this._scene = this._createScene();

        let frameCount = 0;
        this._engine.runRenderLoop(() => {
            this._scene.render();

            if (++frameCount % 2 === 0) {
                this.participantDataUpdatedObservable.notifyObservers(JSON.stringify(this._participantData));
            }
        });

        this._scene.clearColor = new BABYLON.Color3(1, 1, 1);
        window.addEventListener("resize", () => {
            this._engine.resize();
        });
    }

    dispose() {
        this._scene.dispose();
        this._engine.dispose();
    }

    createAvatar() {
        return new Avatar(this._scene);
    }

    _createScene() {
        const engine = this._engine;
        const canvas = engine.getRenderingCanvas();

        var scene = new BABYLON.Scene(engine);
        
        scene.createDefaultEnvironment({
            createSkybox: false,
            createGround: false,
            environmentTexture: "https://assets.babylonjs.com/environments/environmentSpecular.env"
        });
        scene.createDefaultSkybox(scene.environmentTexture, true, 1500, 0.3, false);
        
        scene.createDefaultCamera(false, true, true);
        const camera = scene.activeCamera;
        camera.minZ = 0.2;
        camera.maxZ = 2000;
        camera.position.y = 1.6;
        camera.speed = 0.05;
        camera.rotationQuaternion = BABYLON.Quaternion.Identity();

        BABYLON.SceneLoader.ImportMeshAsync("", "/assets/custom/", "landscape.glb", scene).then(function (loaded) {
            const root = loaded.meshes[0];
            root.position.y += 17;
            root.scaling.scaleInPlace(2);
        });
        BABYLON.SceneLoader.ImportMeshAsync("", "/assets/custom/", "rooftop_simple.glb", scene).then(function (loaded) {
            const root = loaded.meshes[0];
            root.position.y -= 3.65;
        });
        BABYLON.SceneLoader.ImportMeshAsync("", "/assets/custom/", "tree.glb", scene).then(function (loaded) {
            const root = loaded.meshes[0];
            root.position.x = -14.13;
            root.position.y = -3.54;
            root.scaling.scaleInPlace(0.1);

            const instancePlacements = [
                [80, -10, 50, Math.PI / 2],
                [-100, 0, 220, Math.PI],
                [-400, -15, -50, 0],
                [-220, -10, 180, -Math.PI / 2]
            ];
            instancePlacements.forEach((placement) => {
                const instance = instantiateGltf(root, scene);
                instance.position.copyFromFloats(placement[0], placement[1], placement[2]);
                instance.rotation.y = placement[3];
            });
        });
        BABYLON.SceneLoader.ImportMeshAsync("", "/assets/custom/", "scenery_house.glb", scene).then(function (loaded) {
            const root = loaded.meshes[0];
            root.position.y = -3.57;
            root.position.z = 25;
            root.rotationQuaternion = BABYLON.Quaternion.FromEulerAngles(0, Math.PI / 4, 0);

            const instancePlacements = [
                [0, 0, 0, 0]
            ];
            // Procedurally place the town.
            for (let x = 90; x < 110; x += 4) {
                for (let z = 0; z < 60; z += 4) {
                    instancePlacements.push([
                        x + 2 * Math.random() - 1,
                        Math.random() + z / 60,
                        z + 2 * Math.random() - 1,
                        2 * Math.PI * Math.random()
                    ]);
                }
            }
            // Place a few individuals.
            instancePlacements.push([-130, 20, 0, 0]);
            instancePlacements.push([-50, 8, 40, Math.random() * 2 * Math.PI]);
            instancePlacements.push([0, 4, -40, Math.random() * 2 * Math.PI]);
            instancePlacements.push([-97, 89, -122, 0]);
            instancePlacements.push([-80, 6, 0, Math.random() * 2 * Math.PI]);
            const translation = new BABYLON.Vector3();
            instancePlacements.forEach((placement) => {
                translation.copyFromFloats(placement[0], placement[1], placement[2]);
                thinInstantiateGltf(root, translation, placement[3]);
            });
        });
        
        BABYLON.SceneLoader.ImportMeshAsync("", "/assets/custom/", "scenery_tree.glb", scene).then(function (loaded) {
            const root = loaded.meshes[0];
            root.scaling.scaleInPlace(0.1);

            const instancePlacements = [];
            
            const position = new BABYLON.Vector3();
            function plantACopse(center, axis1, axis2, count) {
                for (let idx = 0; idx < count; ++idx) {
                    position.copyFrom(center);
                    axis1.scaleAndAddToRef(Math.random() - 0.5, position);
                    axis2.scaleAndAddToRef(Math.random() - 0.5, position);
                    instancePlacements.push([position.x, position.y, position.z, Math.random() * 2 * Math.PI]);
                }
            }
            plantACopse(new BABYLON.Vector3(-2400, 60, 0), new BABYLON.Vector3(-500, 160, 0), new BABYLON.Vector3(0, 0, 1000), 100);
            plantACopse(new BABYLON.Vector3(-2000, 20, -900), new BABYLON.Vector3(-500, 80, 0), new BABYLON.Vector3(0, 0, 900), 100);
            plantACopse(new BABYLON.Vector3(250, 70, -2200), new BABYLON.Vector3(-1000, -140, 100), new BABYLON.Vector3(60, 60, -500), 100);
            plantACopse(new BABYLON.Vector3(-1300, 180, -2700), new BABYLON.Vector3(-1000, 0, 500), new BABYLON.Vector3(-300, 400, -500), 100);
            
            instancePlacements.forEach((placement) => {
                position.copyFromFloats(placement[0], placement[1], placement[2]);
                thinInstantiateGltf(root, position, placement[3]);
            });
        });

        this._participantData.camera = {};
        scene.onBeforeRenderObservable.add(() => {
            this._participantData.camera.px = parseFloat(scene.activeCamera.position.x.toPrecision(4));
            this._participantData.camera.py = parseFloat(scene.activeCamera.position.y.toPrecision(4));
            this._participantData.camera.pz = parseFloat(scene.activeCamera.position.z.toPrecision(4));
            this._participantData.camera.rx = parseFloat(scene.activeCamera.rotationQuaternion.x.toPrecision(4));
            this._participantData.camera.ry = parseFloat(scene.activeCamera.rotationQuaternion.y.toPrecision(4));
            this._participantData.camera.rz = parseFloat(scene.activeCamera.rotationQuaternion.z.toPrecision(4));
            this._participantData.camera.rw = parseFloat(scene.activeCamera.rotationQuaternion.w.toPrecision(4));
        });

        this._enableXR(scene);

        return scene;
    }

    async _enableXR(scene) {
        if (!navigator.xr) {
            return;
        }

        const xr = await scene.createDefaultXRExperienceAsync({
            disablePointerSelection: true
        });

        xr.baseExperience.camera.minZ = 0.2;
        xr.baseExperience.camera.maxZ = 2000;

        const handsFeature = xr.baseExperience.featuresManager.enableFeature(BABYLON.WebXRFeatureName.HAND_TRACKING, "latest", {
            xrInput: xr.input,
            jointMeshes: {
                enablePhysics: false
            }
        }, true, false);

        // Enable hand tracking
        handsFeature.onHandAddedObservable.add((hand) => {
            this._participantData.hands = {};
            // TODO HACK: Hand readiness hand.onHandMeshReadyObservable.add(() => {
            BABYLON.Tools.DelayAsync(2000).then(() => {
                const handedness = hand.xrController.inputSource.handedness;
                this._participantData.hands[handedness] = {
                    joints: []
                };
                getAnimationNulls(hand.handMesh, handedness).forEach((joint) => {
                    this._participantData.hands[handedness].joints.push([
                        0,
                        0,
                        0,
                        0,
                        0,
                        0,
                        1
                    ]);
                });
                scene.onBeforeRenderObservable.add(() => {
                    const children = getAnimationNulls(hand.handMesh, handedness);
                    for (let idx = 0; idx < children.length; ++idx) {
                        this._participantData.hands[handedness].joints[idx] = [
                            parseFloat(children[idx].position.x.toPrecision(4)),
                            parseFloat(children[idx].position.y.toPrecision(4)),
                            parseFloat(children[idx].position.z.toPrecision(4)),
                            parseFloat(children[idx].rotationQuaternion.x.toPrecision(4)),
                            parseFloat(children[idx].rotationQuaternion.y.toPrecision(4)),
                            parseFloat(children[idx].rotationQuaternion.z.toPrecision(4)),
                            parseFloat(children[idx].rotationQuaternion.w.toPrecision(4))
                        ];
                    }
                });
            });
        });

        this._enableWalking(xr, scene);
    }

    _enableWalking(xr, scene) {
        const sessionManager = xr.baseExperience.sessionManager;
        sessionManager.onXRSessionInit.add(function () {
            const walker = new Walker();

            let pose, m;
            const up = new BABYLON.Vector3();
            const forward = new BABYLON.Vector3();
            const position = new BABYLON.Vector3();

            sessionManager.onXRFrameObservable.add(function (frame) {
                // Compute the base space position, forward, and up
                pose = frame.getViewerPose(sessionManager.baseReferenceSpace);
                if(!pose) return;
                m = pose.transform.matrix;
                up.copyFromFloats(m[4], m[5], -m[6]);
                forward.copyFromFloats(m[8], m[9], -m[10]);
                position.copyFromFloats(m[12], m[13], -m[14]);

                // Compute the nape position
                forward.scaleAndAddToRef(0.05, position);
                up.scaleAndAddToRef(-0.05, position);
                walker.update(position, forward, xr.baseExperience.camera);
            });
        });
    }
}
