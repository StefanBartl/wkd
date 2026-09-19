import { getCollection } from 'astro:content';
import { href, type Skin } from './site';
import { collectTags, type Rendered, renderVimdoc, type TagTarget } from './vimdoc';

// Shared by both skins' help routes: the tag index across every plugin's
// doc/*.txt (so |lib.nvim-async| in cascade's help links to lib.nvim's page)
// and the page path of a given help file.

export function helpPage(plugin: string, file: string, main: boolean): string {
  return main ? `p/${plugin}/help` : `p/${plugin}/help/${file}`;
}

let index: Promise<Map<string, TagTarget>> | null = null;

export function tagIndex(): Promise<Map<string, TagTarget>> {
  index ??= (async () => {
    const map = new Map<string, TagTarget>();
    for (const doc of await getCollection('vimdocs')) {
      const page = helpPage(doc.data.plugin, doc.data.file, doc.data.main);
      for (const tag of collectTags(doc.data.text)) {
        if (!map.has(tag)) map.set(tag, { page });
      }
    }
    return map;
  })();
  return index;
}

export async function renderHelp(text: string, self: string, skin: Skin): Promise<Rendered> {
  const tags = await tagIndex();
  return renderVimdoc(text, {
    resolve: (tag) => tags.get(tag) ?? null,
    href: (page) => href(page, skin),
    self,
  });
}
