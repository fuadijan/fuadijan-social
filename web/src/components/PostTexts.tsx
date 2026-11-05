import { patchPostText } from '../api';
import { EditableText } from './EditableText';
import type { PlatformVersions, PostTextField } from '../types';

export const Body = ({ text, className }: { text: string | null | undefined; className?: string }) => {
  const t = text?.trim() ?? '';
  return <div className={`sa-field-body${t ? '' : ' sa-field-body--muted'}${className ? ` ${className}` : ''}`}>{t || '—'}</div>;
};

export interface PostEdit {
  dayNo: number;
  reload: () => void | Promise<void>;
  onRebuild: () => void;
}

/** A finished text of the post: starts from what shows, and a save goes straight into the pack. */
export function PostText({ dayNo, reload, onRebuild, field, label, value, hint, copy = true, className }: PostEdit & { field: PostTextField; label: string; value: string | null | undefined; hint?: string; copy?: boolean; className?: string }) {
  const text = value?.trim() ?? '';
  return (
    <EditableText
      dayNo={dayNo}
      label={label}
      value={text}
      copyText={copy ? text : null}
      hint={hint}
      save={async (v) => {
        if ((await patchPostText(dayNo, field, v)).rebuilding) onRebuild();
      }}
      onSaved={reload}
    >
      <Body text={text} className={className} />
    </EditableText>
  );
}

const ON_DESIGN = 'This is on the design, so saving makes the designs again.';

/** The post's versions beyond Instagram, each one editable. "All" or a blank platform means every platform; otherwise only those the record names. */
export function PlatformTexts({ p, edit }: { p: PlatformVersions; edit: PostEdit }) {
  const wanted = p.notes.platform.toLowerCase();
  const wants = (name: string) => !wanted || wanted === 'all' || wanted.includes(name);
  const hasFacebook = p.facebook.caption || p.facebook.cta || p.facebook.hashtags.length;
  const hasTikTok = p.tiktok.opening || p.tiktok.hook || p.tiktok.script;
  return (
    <>
      {wants('facebook') && hasFacebook ? (
        <>
          <PostText {...edit} field="facebook_caption" label="Facebook caption" value={p.facebook.caption} />
          <PostText {...edit} field="facebook_cta" label="Facebook CTA" value={p.facebook.cta} />
          <PostText {...edit} field="facebook_hashtags" label="Facebook hashtags" value={p.facebook.hashtags.join(' ')} className="sa-hashtags" />
        </>
      ) : null}
      {wants('tiktok') && hasTikTok ? (
        <>
          <PostText {...edit} field="tiktok_opening" label="TikTok opening text" value={p.tiktok.opening} />
          <PostText {...edit} field="tiktok_hook" label="TikTok hook" value={p.tiktok.hook} />
          <PostText {...edit} field="tiktok_script" label="TikTok script" value={p.tiktok.script} />
          <PostText {...edit} field="tiktok_caption" label="TikTok caption" value={p.tiktok.caption} />
          <PostText {...edit} field="tiktok_cta" label="TikTok CTA" value={p.tiktok.cta} />
          <PostText {...edit} field="tiktok_hashtags" label="TikTok hashtags" value={p.tiktok.hashtags.join(' ')} className="sa-hashtags" />
        </>
      ) : null}
      {p.stories.length ? <PostText {...edit} field="story_sequence" label="Story sequence" value={p.stories.join('\n')} hint="One story per line." /> : null}
      {p.reel_cover ? <PostText {...edit} field="reel_cover_text" label="Reel cover" value={p.reel_cover} hint={ON_DESIGN} /> : null}
      {p.canva.subheading ? <PostText {...edit} field="canva_subheading" label="Label on the design" value={p.canva.subheading} hint={ON_DESIGN} /> : null}
    </>
  );
}
