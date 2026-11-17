import { defineBaseCommands, defineBaseKeymap, defineHistory, union } from '@prosekit/core';
import { defineBlockquote } from '@prosekit/extensions/blockquote';
import { defineBold } from '@prosekit/extensions/bold';
import { defineDoc } from '@prosekit/extensions/doc';
import { defineGapCursor } from '@prosekit/extensions/gap-cursor';
import { defineHardBreak } from '@prosekit/extensions/hard-break';
import { defineHeading } from '@prosekit/extensions/heading';
import { defineHorizontalRule } from '@prosekit/extensions/horizontal-rule';
import { defineImage } from '@prosekit/extensions/image';
import { defineItalic } from '@prosekit/extensions/italic';
import { defineLink } from '@prosekit/extensions/link';
import { defineList } from '@prosekit/extensions/list';
import { defineModClickPrevention } from '@prosekit/extensions/mod-click-prevention';
import { defineParagraph } from '@prosekit/extensions/paragraph';
import { defineStrike } from '@prosekit/extensions/strike';
import { defineTable } from '@prosekit/extensions/table';
import { defineText } from '@prosekit/extensions/text';
import { defineUnderline } from '@prosekit/extensions/underline';
import { defineVirtualSelection } from '@prosekit/extensions/virtual-selection';

// Mirror the prior basic editor feature set except code/code-block support,
// which pulled large Shiki bundles that QFlow does not surface in the UI.
export function defineQFlowBasicExtension() {
  return union(
    defineDoc(),
    defineText(),
    defineParagraph(),
    defineHeading(),
    defineList(),
    defineBlockquote(),
    defineImage(),
    defineHorizontalRule(),
    defineHardBreak(),
    defineTable(),
    defineItalic(),
    defineBold(),
    defineUnderline(),
    defineStrike(),
    defineLink(),
    defineBaseKeymap(),
    defineBaseCommands(),
    defineHistory(),
    defineGapCursor(),
    defineVirtualSelection(),
    defineModClickPrevention(),
  );
}

export type QFlowBasicExtension = ReturnType<typeof defineQFlowBasicExtension>;
