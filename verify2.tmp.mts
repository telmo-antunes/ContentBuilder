import { connectDb, disconnectDb } from './apps/api/src/db';
import { verifyRecipeByRender } from './apps/api/src/lib/htmlDirector/verifyRecipe';
import { dynatosRecipe } from './apps/api/src/lib/htmlDirector/recipes';
import { migrateRecipe } from '@contentbuilder/shared';
await connectDb();
const broken = migrateRecipe({
  ...dynatosRecipe,
  stylesheet: dynatosRecipe.stylesheet.replace('font-size:112px', 'font-size:320px'),
});
console.log('verifying a deliberately BROKEN recipe (320px headline)…');
const out = await verifyRecipeByRender(broken, { format: '1080x1350' });
console.log('VERDICT:', out.verdict, '|', out.notes);
const before = broken.stylesheet.match(/headline\{[^}]*font-size:(\d+)px/)?.[1];
const after = out.recipe.stylesheet.match(/headline\{[^}]*font-size:(\d+)px/)?.[1];
console.log(`headline: ${before}px -> ${after}px | changed=${out.recipe.stylesheet !== broken.stylesheet}`);
await disconnectDb();
