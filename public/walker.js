// A circle buffer of Vector2 samples. Newest sample is at 0.
class CircleBuffer {
    _samples = [];
    _idx = 0;

    constructor (numSamples, initializer) {
        for (let idx = 0; idx < numSamples; ++idx) {
            this._samples.push(initializer ? initializer() : BABYLON.Vector2.Zero());
        }
    }

    get length() {
        return this._samples.length;
    }
    
    push(x, y) {
        this._idx = (this._idx + this._samples.length - 1) % this._samples.length;
        this.at(0).copyFromFloats(x, y);
    }

    at(idx) {
        if (idx >= this._samples.length) {
            throw new Error("Index out of bounds");
        }
        return this._samples[(this._idx + idx) % this._samples.length];
    }
}

class FirstStepDetector {
    _samples = new CircleBuffer(60);
    _entropy = 0;

    onFirstStepDetected = new BABYLON.Observable();

    update(posX, posY, forwardX, forwardY) {
        this._samples.push(posX, posY);
        const origin = this._samples.at(0);

        this._entropy *= this._entropyDecayFactor;
        this._entropy += BABYLON.Vector2.Distance(origin, this._samples.at(1));
        if (this._entropy > this._entropyThreshold) {
            return;
        }

        let samePointIdx;
        for (samePointIdx = this._samePointCheckStartIdx; samePointIdx < this._samples.length; ++samePointIdx) {
            if (BABYLON.Vector2.DistanceSquared(origin, this._samples.at(samePointIdx)) < this._samePointSquaredDistanceThreshold) {
                break;
            }
        }

        if (samePointIdx === this._samples.length) {
            return;
        }

        let apexDistSquared = -1;
        let apexIdx = 0;
        for (let distSquared, idx = 1; idx < samePointIdx; ++idx) {
            distSquared = BABYLON.Vector2.DistanceSquared(origin, this._samples.at(idx));
            if (distSquared > apexDistSquared) {
                apexIdx = idx;
                apexDistSquared = distSquared;
            }
        }

        if (apexDistSquared < this._apexSquaredDistanceThreshold) {
            return;
        }

        const apex = this._samples.at(apexIdx);
        const axis = apex.subtract(origin);
        axis.normalize();

        const vec = new BABYLON.Vector2();
        let dot;
        let sample;
        let sumSquaredProjectionDistances = 0;
        for (let idx = 1; idx < samePointIdx; ++idx) {
            sample = this._samples.at(idx);
            sample.subtractToRef(origin, vec);
            dot = BABYLON.Vector2.Dot(axis, vec);
            sumSquaredProjectionDistances += vec.lengthSquared() - (dot * dot);
        }

        if (sumSquaredProjectionDistances > (samePointIdx * this._squaredProjectionDistanceThreshold)) {
            return;
        }

        const forwardVec = new BABYLON.Vector3(forwardX, forwardY, 0);
        const axisVec = new BABYLON.Vector3(axis.x, axis.y, 0);
        const isApexLeft = BABYLON.Vector3.Cross(forwardVec, axisVec).z > 0;
        const leftApex = origin.clone();
        const rightApex = origin.clone();
        apex.subtractToRef(origin, axis);
        if (isApexLeft) {
            axis.scaleAndAddToRef(this._axisToApexShrinkFactor, leftApex);
            axis.scaleAndAddToRef(this._axisToApexExtendFactor, rightApex);
        } else {
            axis.scaleAndAddToRef(this._axisToApexExtendFactor, leftApex);
            axis.scaleAndAddToRef(this._axisToApexShrinkFactor, rightApex);
        }
        this.onFirstStepDetected.notifyObservers({ 
            leftApex: leftApex,
            rightApex: rightApex,
            currentPosition: origin,
            currentStepDirection: isApexLeft ? "right" : "left"
         });
    }

    reset() {
        for (let idx = 0; idx < this._samples.length; ++idx) {
            this._samples.at(idx).copyFromFloats(0, 0);
        }
    }

    get _samePointCheckStartIdx() {
        return this._samples.length / 3;
    }

    get _samePointSquaredDistanceThreshold() {
        return 0.03 * 0.03;
    }

    get _apexSquaredDistanceThreshold() {
        return 0.09 * 0.09;
    }

    get _squaredProjectionDistanceThreshold() {
        return 0.03 * 0.03;
    }

    get _axisToApexShrinkFactor() {
        return 0.8;
    }

    get _axisToApexExtendFactor() {
        return -1.6;
    }

    get _entropyDecayFactor() {
        return 0.98;
    }

    get _entropyThreshold() {
        return 0.25;
    }
}

class WalkingTracker {
    _leftApex = new BABYLON.Vector2();
    _rightApex = new BABYLON.Vector2();
    _currentPosition = new BABYLON.Vector2();
    _axis = new BABYLON.Vector2();
    _axisLength = -1;
    _forward = new BABYLON.Vector2();
    _steppingLeft = false;
    _t = -1;
    _maxT = -1;
    _maxTPosition = new BABYLON.Vector2();
    _vitality = 0;

    onMovement = new BABYLON.Observable();
    onFootfall = new BABYLON.Observable();

    constructor(leftApex, rightApex, currentPosition, currentStepDirection) {
        this._reset(leftApex, rightApex, currentPosition, currentStepDirection === "left");
    }

    _reset(leftApex, rightApex, currentPosition, steppingLeft) {
        this._leftApex.copyFrom(leftApex);
        this._rightApex.copyFrom(rightApex);
        this._steppingLeft = steppingLeft;
        
        if (this._steppingLeft) {
            this._leftApex.subtractToRef(this._rightApex, this._axis);
            this._forward.copyFromFloats(-this._axis.y, this._axis.x);
        } else {
            this._rightApex.subtractToRef(this._leftApex, this._axis);
            this._forward.copyFromFloats(this._axis.y, -this._axis.x);
        }
        this._axisLength = this._axis.length();
        this._forward.scaleInPlace(1 / this._axisLength);

        this._updateTAndVitality(currentPosition.x, currentPosition.y);
        this._maxT = this._t;
        this._maxTPosition.copyFrom(currentPosition);

        this._vitality = 1;
    }

    _updateTAndVitality(x, y) {
        this._currentPosition.copyFromFloats(x, y);

        if (this._steppingLeft) {
            this._currentPosition.subtractInPlace(this._rightApex);
        } else {
            this._currentPosition.subtractInPlace(this._leftApex);
        }
        const priorT = this._t;
        const dot = BABYLON.Vector2.Dot(this._currentPosition, this._axis);
        this._t = dot / (this._axisLength * this._axisLength);
        const projDistSquared = this._currentPosition.lengthSquared() - (dot / this._axisLength) * (dot / this._axisLength);

        // TODO: Extricate the magic.
        this._vitality *= (0.95 - 100 * Math.max(projDistSquared - 0.0016, 0) + Math.max(this._t - priorT, 0));
    }

    update(x, y) {
        if (this._vitality < this._vitalityThreshold) {
            return false;
        }

        const priorT = this._t;
        this._updateTAndVitality(x, y);
        
        if (this._t > this._maxT) {
            this._maxT = this._t;
            this._maxTPosition.copyFromFloats(x, y);
        }

        if (this._vitality < this._vitalityThreshold) {
            return false;
        }

        if (this._t > priorT) {
            this.onMovement.notifyObservers({ deltaT: (this._t - priorT) });

            if (priorT < 0.5 && this._t >= 0.5) {
                this.onFootfall.notifyObservers({ foot: this._steppingLeft ? "left" : "right" });
            }
        }

        if (this._t < 0.95 * this._maxT) {
            this._currentPosition.copyFromFloats(x, y);
            if (this._steppingLeft) {
                this._leftApex.copyFrom(this._maxTPosition);
            } else {
                this._rightApex.copyFrom(this._maxTPosition);
            }
            this._reset(this._leftApex, this._rightApex, this._currentPosition, !this._steppingLeft);
        }

        if (this._axisLength < 0.03) {
            return false;
        }

        return true;
    }

    get _vitalityThreshold() {
        return 0.1;
    }

    get forward() {
        return this._forward;
    }
}

class Walker {
    _detector = new FirstStepDetector();
    _walker = undefined;
    _movement = new BABYLON.Vector2();

    constructor() {
        this._detector.onFirstStepDetected.add((event) => {
            if (!this._walker) {
                this._walker = new WalkingTracker(event.leftApex, event.rightApex, event.currentPosition, event.currentStepDirection);
                this._walker.onFootfall.add(() => {
                    console.log("Footfall!");
                });
                this._walker.onMovement.add((event) => {
                    this._walker.forward.scaleAndAddToRef(0.024 * event.deltaT, this._movement);
                });
            }
        });
    }

    update(position, forward, xrCamera) {
        forward.y = 0;
        forward.normalize();

        this._detector.update(position.x, position.z, forward.x, forward.z);
        if (this._walker) {
            const updated = this._walker.update(position.x, position.z);
            if (!updated) {
                this._walker = undefined;
            }
        }

        xrCamera.position.x += this._movement.x;
        xrCamera.position.z += this._movement.y;
        this._movement.scaleInPlace(0.96);
    }
}

// Helper class for conveniently making frame-dependent logic (as is used in Walker)
// more resilient to framerate variations.
class FixedUpdateProvider {
    onFixedUpdateObservable;

    constructor (scene, framerate) {
        this.onFixedUpdateObservable = new BABYLON.Observable();
        const updateIntervalMs = 1000 / framerate;
        let elapsedTime = 0;
        const beforeRenderObserver = scene.onBeforeRenderObservable.add(() => {
            elapsedTime += scene.deltaTime;
            for (; elapsedTime >= updateIntervalMs; elapsedTime -= updateIntervalMs) {
                this.onFixedUpdateObservable.notifyObservers();
            }
        });
        const disposeObserver = scene.onDisposeObservable.add(function () {
            scene.onBeforeRenderObservable.remove(beforeRenderObserver);
            scene.onDisposeObservable.remove(disposeObserver);
        });
    }
}
