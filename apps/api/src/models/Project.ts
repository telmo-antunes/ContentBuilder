import mongoose, { type Model } from 'mongoose';
import { baseSchemaOptions } from './common';

const { Schema, model, models } = mongoose;

const frameSchema = new Schema(
  { x: { type: Number }, y: { type: Number }, w: { type: Number }, h: { type: Number } },
  { _id: false },
);

/** One of the user's photos on a slide — see shared/slidePhotos.ts. */
const slidePhotoSchema = new Schema(
  {
    id: { type: String, required: true },
    mediaAssetId: { type: Schema.Types.ObjectId, ref: 'MediaAsset', required: true },
    placement: { type: String, enum: ['slot', 'background', 'free'], required: true },
    /** 'slot': the authored placeholder this fills (its data-cb-slot name). */
    slot: { type: String, required: false },
    /** 'free': where it sits on the canvas, as fractions [0..1]. */
    frame: { type: frameSchema, required: false },
    fit: { type: String, enum: ['cover', 'contain'], required: false },
    /** Which part of the photo survives the crop, as fractions [0..1]. */
    focal: {
      type: new Schema({ x: { type: Number }, y: { type: Number } }, { _id: false }),
      required: false,
    },
    /** How this photo drifts in a video export ('auto' follows the brand). */
    motion: { type: String, required: false },
    /** 'slot': resize the authored hole without rewriting its markup. */
    shape: { type: String, enum: ['standard', 'wide', 'square', 'tall'], required: false },
    size: { type: String, enum: ['sm', 'md', 'lg'], required: false },
    /** 'free': negative sends it behind the composition. */
    z: { type: Number, required: false },
    alt: { type: String, required: false },
  },
  { _id: false },
);

/**
 * Slides are authored-first. Block-era fields (`layoutType`, `blocks`, most of
 * `overrides.*`) and the pre-photos-layer `mediaAssetId` are gone from the
 * schema; documents stored before those pivots may still carry them, and
 * Mongoose strict mode simply ignores those stored fields on read — nothing
 * crashes, nothing surfaces them. (`npm run migrate:photos` folds a stored
 * `mediaAssetId` into `photos` so the picture isn't merely ignored.)
 */
const slideSchema = new Schema(
  {
    id: { type: String, required: true },
    order: { type: Number, required: true },
    imageNeed: { type: String, enum: ['none', 'upload'], default: 'none' },
    /** The user's own photos on this slide (slot fills, background, overlays). */
    photos: { type: [slidePhotoSchema], default: [] },
    /** The stock-search phrase the AI art director chose (prefills the editor's stock picker). */
    imageQuery: { type: String, required: false },
    /** The parse step's one-line reasoning for this slide's calls — review-page insight. */
    rationale: { type: String, required: false },
    overrides: {
      type: new Schema(
        {
          focalPoint: {
            type: new Schema(
              { x: { type: Number }, y: { type: Number } },
              { _id: false },
            ),
            required: false,
          },
          imageTreatment: { type: String, enum: ['none', 'tint', 'duotone'], required: false },
          bleedAnchor: { type: String, enum: ['top', 'bottom'], required: false },
          theme: { type: String, enum: ['editorial', 'bold', 'minimal', 'soft'], required: false },
        },
        { _id: false },
      ),
      required: false,
    },
    /** AI-authored slide markup (semantic HTML using the brand recipe's classes)
     *  — what the renderer mounts. */
    authored: {
      type: new Schema(
        {
          html: { type: String, required: true },
          bg: { type: String, required: false },
          /** The composer's slide role — drives per-role motion in video export. */
          role: { type: String, required: false },
          /** How the slide is composed — owns where its leftover space lands. */
          archetype: { type: String, required: false },
          /** Prompt versions that wrote + arranged this slide. */
          pv: { type: Schema.Types.Mixed, required: false },
          /**
           * WHICH PATH BUILT THIS SLIDE — 'fragment' (deterministic
           * substitution, no model call) or 'ai' (composed for this slide
           * alone).
           *
           * Was telemetry that the route threw away, which left the only record
           * of the split in the markup itself — and the markup cannot answer it.
           * A fragment fill and a model compose that happened to follow the same
           * recipe order are byte-comparable, `balanceVertical` moves the
           * spacers of both, and repeated rows make the two skeletons different
           * lengths in opposite directions. Inferring it read `list` as 0%
           * fragment when its fragment substitutes cleanly in every shape a list
           * slide comes in. Stored, it is simply known.
           */
          source: { type: String, enum: ['fragment', 'ai'], required: false },
          /**
           * This slide's alignment when it deviates from the brand default —
           * the parse step's per-deck call (or a hand edit). Rendered as
           * `data-align`; absent means the brand's global alignment stands.
           */
          align: { type: String, enum: ['flush-left', 'center', 'flush-right'], required: false },
        },
        { _id: false },
      ),
      required: false,
    },
  },
  { _id: false },
);

const projectSchema = new Schema(
  {
    businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true, index: true },
    title: { type: String, required: true, trim: true },
    type: { type: String, enum: ['carousel', 'story'], required: true },
    format: { type: String, required: true },
    slides: { type: [slideSchema], default: [] },
    /**
     * Where a compose has got to, written as it enters each phase and cleared
     * when it finishes.
     *
     * `POST /compose` is synchronous and emitted nothing between request and
     * response, so a deck that took 300 seconds and one that had wedged looked
     * identical — and three runs did wedge, persisting nothing at all. This is
     * the crumb trail: a caller can poll `GET /projects/:id` to tell slow from
     * stuck, and a wedge leaves behind the phase it stuck in.
     */
    composeProgress: {
      type: new Schema(
        {
          phase: { type: String, required: true },
          done: { type: Number },
          total: { type: Number },
          at: { type: Date, required: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    /** URLs of the last export's PNGs (drives the send-to-phone share page). */
    renders: { type: [String], default: undefined },
    /** The social caption + hashtags for this post, generated in the brand voice. */
    caption: {
      type: new Schema(
        { text: { type: String, default: '' }, hashtags: { type: [String], default: [] } },
        { _id: false },
      ),
      required: false,
    },
    settings: {
      type: new Schema(
        {
          theme: { type: String, enum: ['editorial', 'bold', 'minimal', 'soft'], required: false },
          slideCounter: { type: Boolean, required: false },
          dmKeyword: { type: String, required: false, maxlength: 24 },
          audience: { type: String, enum: ['car owner', 'studio owner'], required: false },
        },
        { _id: false },
      ),
      required: false,
    },
    status: { type: String, enum: ['draft', 'rendered'], default: 'draft' },
    /** Workflow stage — the Desk's columns. Separate from `status` on purpose. */
    stage: { type: String, enum: ['idea', 'drafting', 'ready', 'shipped'], index: true },
    /** The prompt behind the post (an 'idea' card has this and no slides yet). */
    idea: { type: String, required: false },
    /**
     * The per-slide plan the post was composed against — one direction per
     * slide, in order. Absent means the deck was written freely from the brief.
     * Kept so re-composing starts from what the user actually asked for rather
     * than from a paragraph that lost its structure.
     */
    plan: { type: [String], required: false },
    /**
     * The pages this post was WRITTEN FROM. Kept so a claim on a slide can be
     * checked against the article that produced it — the single most useful
     * thing to know about an AI-written deck, and until now the only party that
     * ever saw it was the prompt.
     */
    sources: {
      type: [
        new Schema(
          {
            url: { type: String, required: true },
            title: { type: String, required: false },
            byline: { type: String, required: false },
            published: { type: String, required: false },
            /** How much readable text was taken from it. */
            chars: { type: Number, required: false },
          },
          { _id: false },
        ),
      ],
      required: false,
    },
    /**
     * For a promo story: the carousel it points at.
     *
     * A plain ref rather than a subtype — a promo story is an ordinary story
     * project in every other respect, and making it a special kind of object
     * would mean teaching the editor, the exporter and the Desk about a
     * distinction none of them need. Nothing cascades: deleting the carousel
     * leaves a story that still renders, holding a picture of something that
     * no longer exists as a project, which is the same situation as any other
     * exported asset.
     */
    promotes: { type: Schema.Types.ObjectId, ref: 'Project', required: false, index: true },

    /** Set automatically on export; `postedAt` is the manual "it went live" tick. */
    exportedAt: { type: Date, required: false },
    postedAt: { type: Date, required: false },
    /**
     * THE DECISION LEDGER for the last compose: consequential calls the CODE
     * took on the deck's behalf (a full-bleed photo dropped for fighting the
     * brand ground, and whatever joins it). These used to live in console.warn
     * — a decision nobody can see is a decision nobody can improve, so the
     * review page now shows them. Replaced wholesale on every compose.
     */
    composeNotes: {
      type: [
        new Schema(
          { slide: { type: Number, required: false }, note: { type: String, required: true } },
          { _id: false },
        ),
      ],
      required: false,
    },
    /**
     * THE RECIPE THIS DECK SHIPPED UNDER, pinned at first export. Decks render
     * live against the brand's recipe, which is right while they are being
     * made and wrong forever after: replacing the recipe re-skinned every deck
     * already reviewed. When present, every render path uses this instead of
     * the kit's live recipe.
     */
    recipeSnapshot: { type: Schema.Types.Mixed, required: false },
    recipeSnapshotAt: { type: Date, required: false },
    /**
     * WHAT THIS POST COST, from the last compose: total, ceiling, per-feature
     * breakdown, and any step the ceiling turned down. See lib/spend.ts.
     */
    spend: { type: Schema.Types.Mixed, required: false },
    /** The art-director review of the last rendered deck. See lib/htmlDirector/deckCritique.ts. */
    critique: { type: Schema.Types.Mixed, required: false },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
  },
  baseSchemaOptions,
);

projectSchema.pre('save', function updateTimestamp(next) {
  this.set('updatedAt', new Date());
  next();
});

export const ProjectModel: Model<any> = models.Project ?? model('Project', projectSchema);
