import { describe, test, expect, beforeEach } from 'vitest';
import { createDocumentRenderer } from '../../src/renderers/content/document.js';
import { defaultBehavior, mergeBehavior } from '../../src/engine/behavior-config.js';

describe('snapshot — document renderer', () => {
  /** @type {HTMLElement} */
  let mount;
  beforeEach(() => {
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  test('excerpt mode with expand button (long body)', () => {
    const longBody = Array(220).fill('word').join(' ');
    createDocumentRenderer({
      item: { content_title: 'Long Doc', content_metadata: { body: longBody } },
      behavior: mergeBehavior(defaultBehavior(), {
        doc_display: 'excerpt',
        expand_button: true,
      }),
      mount,
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });

  test('fullscreen_reader mode (full body inline)', () => {
    createDocumentRenderer({
      item: {
        content_title: 'Reader Mode Doc',
        content_metadata: { body: 'A body that is short enough to fit fully.' },
      },
      behavior: mergeBehavior(defaultBehavior(), { doc_display: 'fullscreen_reader' }),
      mount,
    });
    expect(mount.innerHTML).toMatchSnapshot();
  });
});
