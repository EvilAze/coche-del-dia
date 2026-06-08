const fs = require('fs');
let css = fs.readFileSync('src/index.css', 'utf8');

css = css.replace(
  'position: relative; width: 100%; aspect-ratio: 5 / 4; overflow: hidden;',
  'position: relative; width: 100%; aspect-ratio: 1 / 1; overflow: hidden;'
);

css = css.replace(
  '.cdd-lightbox-frame { width: min(94vw, calc(80vh * 5 / 4)); aspect-ratio: 5 / 4; }',
  '.cdd-lightbox-frame { width: min(94vw, 80vh); aspect-ratio: 1 / 1; }'
);

css = css.replace(
  '.cdd-fold .cdd-stage { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; justify-content: center; }',
  '.cdd-fold .cdd-stage { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; justify-content: center; align-items: center; }'
);

css = css.replace(
  '.cdd-fold .cdd-stage-frame { aspect-ratio: auto; flex: 1 1 auto; min-height: 150px; }',
  '.cdd-fold .cdd-stage-frame { aspect-ratio: 1 / 1; width: 100%; max-height: 100%; height: auto; flex: none; }'
);

css = css.replace(
  '.cdd-fold .cdd-stage.revealed .cdd-stage-frame { flex: none; height: auto; }',
  '.cdd-fold .cdd-stage.revealed .cdd-stage-frame { flex: none; width: 100%; max-height: 100%; height: auto; }'
);

css = css.replace(
  '.cdd-stage-frame { aspect-ratio: 16 / 11; }',
  '.cdd-stage-frame { aspect-ratio: 1 / 1; }'
);

css = css.replace(
  '.cdd-lightbox-frame { width: min(82vw, calc(82vh * 16 / 11)); aspect-ratio: 16 / 11; }',
  '.cdd-lightbox-frame { width: min(82vw, 82vh); aspect-ratio: 1 / 1; }'
);

fs.writeFileSync('src/index.css', css);
