import type { Types } from '@cornerstonejs/core';
import { utilities as csUtils } from '@cornerstonejs/core';
import { vec3 } from 'gl-matrix';

import BrushStrategy from './BrushStrategy';
import type { InitializedOperationData, Composition } from './BrushStrategy';
import compositions from './compositions';
import StrategyCallbacks from '../../../enums/StrategyCallbacks';
import { createEllipseInPoint } from './fillCircle';
const { transformWorldToIndex } = csUtils;
import { getSphereBoundsInfoFromViewport } from '../../../utilities/getSphereBoundsInfo';

const sphereComposition = {
  [StrategyCallbacks.Initialize]: (operationData: InitializedOperationData) => {
    const { points, viewport, segmentationImageData } = operationData;

    // Happens on a preview setup
    if (!points) {
      return;
    }
    // Average the points to get the center of the ellipse
    const center = vec3.fromValues(0, 0, 0);
    points.forEach((point) => {
      vec3.add(center, center, point);
    });
    vec3.scale(center, center, 1 / points.length);

    operationData.centerWorld = center as Types.Point3;
    operationData.centerIJK = transformWorldToIndex(
      segmentationImageData,
      center as Types.Point3
    );

    const {
      boundsIJK: newBoundsIJK,
      topLeftWorld,
      bottomRightWorld,
    } = getSphereBoundsInfoFromViewport(
      points.slice(0, 2) as [Types.Point3, Types.Point3],
      segmentationImageData,
      viewport
    );

    operationData.isInObjectBoundsIJK = newBoundsIJK;
    operationData.isInObject = createEllipseInPoint({
      topLeftWorld,
      bottomRightWorld,
      center,
    });
    // }
  },
} as Composition;

const SPHERE_STRATEGY = new BrushStrategy(
  'Sphere',
  compositions.regionFill,
  compositions.setValue,
  sphereComposition,
  compositions.determineSegmentIndex,
  compositions.preview,
  compositions.labelmapStatistics,
  compositions.ensureSegmentationVolumeFor3DManipulation
);

/**
 * Fill inside a sphere with the given segment index in the given operation data. The
 * operation data contains the sphere required points.
 * @param enabledElement - The element that is enabled and selected.
 * @param operationData - OperationData
 */
const fillInsideSphere = SPHERE_STRATEGY.strategyFunction;

const SPHERE_THRESHOLD_STRATEGY = new BrushStrategy(
  'SphereThreshold',
  ...SPHERE_STRATEGY.compositions,
  compositions.dynamicThreshold,
  compositions.threshold,
  compositions.ensureSegmentationVolumeFor3DManipulation,
  compositions.ensureImageVolumeFor3DManipulation
);

const SPHERE_THRESHOLD_STRATEGY_ISLAND = new BrushStrategy(
  'SphereThreshold',
  ...SPHERE_STRATEGY.compositions,
  compositions.dynamicThreshold,
  compositions.threshold,
  compositions.islandRemoval,
  compositions.ensureSegmentationVolumeFor3DManipulation,
  compositions.ensureImageVolumeFor3DManipulation
);

/**
 * Fill inside the circular region segment inside the segmentation defined by the operationData.
 * It fills the segmentation pixels inside the defined circle.
 * @param enabledElement - The element for which the segment is being filled.
 * @param operationData - EraseOperationData
 */

const thresholdInsideSphere = SPHERE_THRESHOLD_STRATEGY.strategyFunction;
const thresholdInsideSphereIsland =
  SPHERE_THRESHOLD_STRATEGY_ISLAND.strategyFunction;

/**
 * Fill outside a sphere with the given segment index in the given operation data. The
 * operation data contains the sphere required points.
 * @param enabledElement - The element that is enabled and selected.
 * @param operationData - OperationData
 */
export function fillOutsideSphere(): void {
  throw new Error('fill outside sphere not implemented');
}

export {
  fillInsideSphere,
  thresholdInsideSphere,
  SPHERE_STRATEGY,
  thresholdInsideSphereIsland,
};
