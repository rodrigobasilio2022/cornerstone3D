import { vec3 } from 'gl-matrix';
import { CONSTANTS, metaData, utilities } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import type { Annotations, Annotation } from '../../types';

const { isEqual } = utilities;

const { EPSILON } = CONSTANTS;

const PARALLEL_THRESHOLD = 1 - EPSILON;

/**
 * given some `Annotations`, and the slice defined by the camera's normal
 * direction and the spacing in the normal, filter the `Annotations` which
 * is within the slice.
 *
 * @param annotations - Annotations
 * @param camera - The camera
 * @param spacingInNormalDirection - The spacing in the normal direction
 * @returns The filtered `Annotations`.
 */
export default function filterAnnotationsWithinSlice(
  annotations: Annotations,
  camera: Types.ICamera,
  spacingInNormalDirection: number
): Annotations {
  const { viewPlaneNormal } = camera;

  // The reason we use parallel normals instead of actual orientation is that
  // flipped action is done through camera API, so we can't rely on the
  // orientation (viewplaneNormal and viewUp) since even the same image and
  // same slice if flipped will have different orientation, but still rendering
  // the same slice. Instead, we choose to use the parallel normals to filter
  // the annotations and later we fine tune it with the annotation within slice
  // logic down below.
  const annotationsWithParallelNormals = annotations.filter(
    (td: Annotation) => {
      const { planeRestriction, referencedImageId } = td.metadata;
      let { viewPlaneNormal: annotationViewPlaneNormal } = td.metadata;

      if (planeRestriction) {
        const { inPlaneVector1, inPlaneVector2 } = planeRestriction;
        if (
          inPlaneVector1 &&
          !isEqual(0, vec3.dot(viewPlaneNormal, inPlaneVector1))
        ) {
          return false;
        }
        if (
          inPlaneVector2 &&
          !isEqual(0, vec3.dot(viewPlaneNormal, inPlaneVector2))
        ) {
          return false;
        }
        return true;
      }

      if (
        !td.metadata.referencedImageId &&
        !annotationViewPlaneNormal &&
        td.metadata.FrameOfReferenceUID
      ) {
        for (const point of td.data.handles.points) {
          const vector = vec3.sub(vec3.create(), point, camera.focalPoint);
          const dotProduct = vec3.dot(vector, viewPlaneNormal);
          if (!isEqual(dotProduct, 0)) {
            return false;
          }
        }
        td.metadata.viewPlaneNormal = viewPlaneNormal;
        td.metadata.cameraFocalPoint = camera.focalPoint;
        return true;
      }

      if (!annotationViewPlaneNormal && referencedImageId) {
        // This code is run to set the annotation view plane normal
        // for historical data which was saved without the normal.
        const { imageOrientationPatient } = metaData.get(
          'imagePlaneModule',
          referencedImageId
        );
        const rowCosineVec = vec3.fromValues(
          imageOrientationPatient[0],
          imageOrientationPatient[1],
          imageOrientationPatient[2]
        );

        const colCosineVec = vec3.fromValues(
          imageOrientationPatient[3],
          imageOrientationPatient[4],
          imageOrientationPatient[5]
        );

        annotationViewPlaneNormal = vec3.create() as Types.Point3;

        vec3.cross(annotationViewPlaneNormal, rowCosineVec, colCosineVec);
        td.metadata.viewPlaneNormal = annotationViewPlaneNormal;
      }

      const isParallel =
        Math.abs(vec3.dot(viewPlaneNormal, annotationViewPlaneNormal)) >
        PARALLEL_THRESHOLD;

      return annotationViewPlaneNormal && isParallel;
    }
  );

  // No in plane annotations.
  if (!annotationsWithParallelNormals.length) {
    return [];
  }

  // Annotation should be within the slice, which means that it should be between
  // camera's focalPoint +/- spacingInNormalDirection.

  const halfSpacingInNormalDirection = spacingInNormalDirection / 2;
  const { focalPoint } = camera;

  const annotationsWithinSlice = [];

  for (const annotation of annotationsWithParallelNormals) {
    const data = annotation.data;

    const point = data.handles.points[0] || data.contour?.polyline[0];

    if (!annotation.isVisible) {
      continue;
    }
    // A = point
    // B = focal point
    // P = normal

    // B-A dot P  => Distance in the view direction.
    // this should be less than half the slice distance.

    const dir = vec3.create();

    // If the handles has no values, eg a key image or other annotation, it
    // should just be included.
    if (!point) {
      annotationsWithinSlice.push(annotation);
      continue;
    }

    vec3.sub(dir, focalPoint, point);

    const dot = vec3.dot(dir, viewPlaneNormal);

    if (Math.abs(dot) < halfSpacingInNormalDirection) {
      annotationsWithinSlice.push(annotation);
    }
  }

  return annotationsWithinSlice;
}
