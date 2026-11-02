'use client';
import type { ModelCatalog } from '@/lib/models';
import type { ModelAction } from '@/lib/schema';
import { latestInFamily, modelFamilies } from '@/lib/model-choice';

export function ModelPicker({ action, value, catalog, error, loading, onChange, retry, required = true }: {
  action: ModelAction; value: string; catalog: ModelCatalog | null; error: string; loading: boolean; required?: boolean;
  onChange: (model: string) => void; retry: () => void;
}) {
  const label = { analyze: 'Website analysis model', generate: 'Generation model', revise: 'Revision model', complete: 'Autocomplete model', rephrase: 'Rephrasing model', chat: 'Chat model', agent: 'Agent model' }[action];
  const needsVision = action === 'analyze' || action === 'generate' || action === 'revise' || action === 'agent';
  // Slides arrive as streamed plain text; the other actions answer in JSON.
  const needsStructured = action !== 'generate' && action !== 'revise';
  return <div className="model-picker"><label htmlFor={`model-${action}`}>{label}</label>
    <select id={`model-${action}`} value={value} onChange={event => onChange(event.target.value)} required={required && catalog !== null && !catalog.defaultModel}>
      <option value="">{catalog?.defaultModel ? `Default · ${catalog.models.find(m => m.id === catalog.defaultModel)?.name ?? catalog.defaultModel}` : catalog ? 'Choose a model' : 'Configured default'}</option>
      {modelFamilies.map(family => {
        const model = catalog && latestInFamily(catalog.models, family);
        return model ? <option key={family} value={`latest:${family}`} disabled={(needsVision && model.vision === false) || (needsStructured && model.structured === false)}>Latest {family[0].toUpperCase() + family.slice(1)} · {model.name}</option> : null;
      })}
      {value && !catalog?.models.some(model => model.id === value) && !(value.startsWith('latest:') && catalog && latestInFamily(catalog.models, value.slice(7))) ? <option value={value}>{value} · saved selection</option> : null}
      {catalog?.models.map(model => {
        const unavailable = needsVision && model.vision === false ? 'no image input' : needsStructured && model.structured === false ? 'no structured output' : '';
        return <option key={model.id} value={model.id} disabled={!!unavailable}>{model.name}{unavailable ? ` · ${unavailable}` : ''}</option>;
      })}
    </select>
    {loading ? <p className="field-hint">Loading available models…</p> : error ? <p className="field-hint">{error} <button type="button" className="text-button" onClick={retry}>Retry models</button></p> : null}
  </div>;
}
