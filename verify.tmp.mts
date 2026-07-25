import { connectDb, disconnectDb } from './apps/api/src/db';
import { verifyRecipeByRender } from './apps/api/src/lib/htmlDirector/verifyRecipe';
import { dynatosRecipe } from './apps/api/src/lib/htmlDirector/recipes';
import { migrateRecipe } from '@contentbuilder/shared';
await connectDb();
// A deliberately BROKEN recipe: type far too large for the canvas → must overflow.
const broken = migrateRecipe({
  ...dynatosRecipe,
  stylesheet: dynatosRecipe.stylesheet
    .replace('font-size:112px', 'font-size:320px')
    .replace('font-size:34px', 'font-size:120px'),
});
console.log('--- verifying a DELIBERATELY BROKEN recipe (320px headline) ---');
const out = await verifyRecipeByRender(broken, { format: '1080x1350' });
console.log('verdict:', out.verdict);
console.log('notes  :', out.notes);
const before = broken.stylesheet.match(/\.headline\{[^}]*font-size:(\d+)px/)?.[1];
const after = out.recipe.stylesheet.match(/\.headline\{[^}]*font-size:(\d+)px/)?.[1];
console.log(`headline font-size: ${before}px → ${after}px`);
console.log('stylesheet changed:', out.recipe.stylesheet !== broken.stylesheet);
await disconnectDb();
