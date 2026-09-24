// Single client entry so the shared src/lib/site.ts is inlined into one chunk
// (two requests, no import waterfall) instead of a separate module.
import './hue';
import './prefs';
import './search';
import './stats';
import './views';
import './vim';
