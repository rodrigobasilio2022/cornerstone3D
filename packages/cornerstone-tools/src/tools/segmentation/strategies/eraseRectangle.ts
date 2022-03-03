import { getBoundingBoxAroundShape } from '../../../util/segmentation'
import { Point3 } from '../../../types'
import { ImageVolume, Types } from '@precisionmetrics/cornerstone-render'
import { triggerSegmentationDataModified } from '../../../store/SegmentationModule/triggerSegmentationEvents'
import pointInShapeCallback from '../../../util/planar/pointInShapeCallback'

type EraseOperationData = {
  toolGroupUID: string
  segmentationDataUID: string
  points: [Point3, Point3, Point3, Point3]
  volume: ImageVolume
  constraintFn: (x: [number, number, number]) => boolean
  segmentsLocked: number[]
}

function eraseRectangle(
  enabledElement: Types.IEnabledElement,
  operationData: EraseOperationData,
  inside = true
): void {
  const {
    volume: segmentation,
    points,
    segmentsLocked,
    segmentationDataUID,
    toolGroupUID,
  } = operationData
  const { imageData, dimensions, scalarData } = segmentation

  const rectangleCornersIJK = points.map((world) => {
    return imageData.worldToIndex(world)
  })

  const boundsIJK = getBoundingBoxAroundShape(rectangleCornersIJK, dimensions)

  if (boundsIJK.every(([min, max]) => min !== max)) {
    throw new Error('Oblique segmentation tools are not supported yet')
  }

  // Since always all points inside the boundsIJK is inside the rectangle...
  const pointInShape = () => true

  const callback = ({ value, index }) => {
    if (segmentsLocked.includes(value)) {
      return
    }
    scalarData[index] = 0
  }

  pointInShapeCallback(
    boundsIJK,
    scalarData,
    imageData,
    dimensions,
    pointInShape,
    callback
  )

  triggerSegmentationDataModified(toolGroupUID, segmentationDataUID)
}

/**
 * Erase the rectangle region segment inside the segmentation defined by the operationData.
 * It erases the segmentation pixels inside the defined rectangle.
 * @param enabledElement - The element for which the segment is being erased.
 * @param {EraseOperationData} operationData - EraseOperationData
 */
export function eraseInsideRectangle(
  enabledElement: Types.IEnabledElement,
  operationData: EraseOperationData
): void {
  eraseRectangle(enabledElement, operationData, true)
}

/**
 * Erase the rectangle region segment inside the segmentation defined by the operationData.
 * It erases the segmentation pixels outside the defined rectangle.
 * @param enabledElement - The element for which the segment is being erased.
 * @param {EraseOperationData} operationData - EraseOperationData
 */
export function eraseOutsideRectangle(
  enabledElement: Types.IEnabledElement,
  operationData: EraseOperationData
): void {
  eraseRectangle(enabledElement, operationData, false)
}