/**
 * Minimal safety pass for an AI-authored recipe stylesheet before it is injected
 * via <style> at render. The stylesheet is trusted-ish (it's brand design CSS,
 * not user input), but it is model output, so we strip the handful of CSS
 * constructs that can escape the sandbox or fetch/execute: a </style> breakout,
 * @import, expression(), javascript:/vbscript: URLs, and scripting properties.
 */
export function sanitizeRecipeCss(css: string): string {
  if (!css) return '';
  let out = css;
  out = out.replace(/<\/?\s*style/gi, ''); // no </style> breakout
  out = out.replace(/<script[\s\S]*?<\/script>/gi, '');
  out = out.replace(/@import[^;]*;?/gi, ''); // no external imports
  out = out.replace(/@charset[^;]*;?/gi, '');
  out = out.replace(/expression\s*\(/gi, '('); // legacy IE expression()
  out = out.replace(/(?:javascript|vbscript)\s*:/gi, ''); // scheme in url()/content
  out = out.replace(/(?:behavior|-moz-binding)\s*:[^;}]*;?/gi, ''); // scripting props
  return out.trim();
}
