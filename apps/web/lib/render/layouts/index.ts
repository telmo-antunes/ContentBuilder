import type { FC } from 'react';
import type { LayoutType } from '@contentbuilder/shared';
import type { LayoutProps } from '../types';
import Cover from './Cover';
import BackgroundImage from './BackgroundImage';
import CenteredHero from './CenteredHero';
import TextOnly from './TextOnly';
import SplitImageText from './SplitImageText';
import Statement from './Statement';
import Checklist from './Checklist';
import Quote from './Quote';
import CTA from './CTA';
import FreePosition from './FreePosition';

/** The ONLY way slides are rendered — every archetype maps to one component. */
export const LAYOUT_REGISTRY: Record<LayoutType, FC<LayoutProps>> = {
  Cover,
  BackgroundImage,
  CenteredHero,
  TextOnly,
  SplitImageText,
  Statement,
  Checklist,
  Quote,
  CTA,
  FreePosition,
};
