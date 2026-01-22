import type InterpolationType from '../enums/InterpolationType';
import type { ViewportProperties } from './ViewportProperties';

/**
 * Stack Viewport Properties
 */
type StackViewportProperties = ViewportProperties & {
  /** interpolation type - linear or nearest neighbor */
  interpolationType?: InterpolationType;
  /** suppress events (optional) */
  suppressEvents?: boolean;
  /** Indicates if the voi is a computed VOI (not user set) */
  isComputedVOI?: boolean;
  /**
   * List of modalities that should use per-image VOI values instead of series VOI.
   * For these modalities, each image in the stack maintains its own window/level
   * from metadata, and user adjustments are remembered per-image.
   * Default: ['XA', 'DR', 'CR']
   */
  perImageVOIModalities?: string[];
};

export type { StackViewportProperties as default };
