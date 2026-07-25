import { connectDb, disconnectDb } from './apps/api/src/db';
import { verifyRecipeByRender } from './apps/api/src/lib/htmlDirector/verifyRecipe';
import { detailMastersRecipe } from './apps/api/src/lib/htmlDirector/recipes';
await connectDb();
console.log('verifying the HAND-AUTHORED DetailMasters recipe (should pass)…');
const out = await verifyRecipeByRender(detailMastersRecipe, { format: '1080x1350' });
console.log('VERDICT:', out.verdict, '|', out.notes);
console.log('stylesheet untouched:', out.recipe.stylesheet === detailMastersRecipe.stylesheet);
await disconnectDb();
