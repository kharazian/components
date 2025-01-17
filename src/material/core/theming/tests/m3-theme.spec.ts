import {parse} from 'postcss';
import {compileString} from 'sass';
import {runfiles} from '@bazel/runfiles';
import * as path from 'path';

import {createLocalAngularPackageImporter} from '../../../../../tools/sass/local-sass-importer';
import {pathToFileURL} from 'url';

// Note: For Windows compatibility, we need to resolve the directory paths through runfiles
// which are guaranteed to reside in the source tree.
const testDir = path.join(runfiles.resolvePackageRelative('../_all-theme.scss'), '../tests');
const packagesDir = path.join(runfiles.resolveWorkspaceRelative('src/cdk/_index.scss'), '../..');

const localPackageSassImporter = createLocalAngularPackageImporter(packagesDir);

const mdcSassImporter = {
  findFileUrl: (url: string) => {
    if (url.toString().startsWith('@material')) {
      return pathToFileURL(
        path.join(runfiles.resolveWorkspaceRelative('./node_modules'), url),
      ) as URL;
    }
    return null;
  },
};

/** Transpiles given Sass content into CSS. */
function transpile(content: string) {
  return compileString(
    `
        @use '../../../index' as mat;
        @use '../../../../material-experimental/index' as matx;

        $internals: _mat-theming-internals-do-not-access;

        $theme: matx.define-theme();

        ${content}
      `,
    {
      loadPaths: [testDir],
      importers: [localPackageSassImporter, mdcSassImporter],
    },
  ).css.toString();
}

function union<T>(...sets: Set<T>[]): Set<T> {
  return new Set(sets.flatMap(s => [...s]));
}

function intersection<T>(set: Set<T>, ...sets: Set<T>[]): Set<T> {
  return new Set([...set].filter(i => sets.every(s => s.has(i))));
}

describe('M3 theme', () => {
  it('should emit all styles under the given selector', () => {
    const root = parse(
      transpile(`
      html {
        @include mat.all-component-themes($theme);
        @include mat.all-component-bases($theme);
        @include mat.all-component-colors($theme);
        @include mat.all-component-typographies($theme);
        @include mat.all-component-densities($theme);
      }
    `),
    );
    const selectors: string[] = [];
    root.walkRules(rule => {
      selectors.push(rule.selector);
    });
    expect(selectors).toEqual(['html']);
  });

  it('should only emit CSS variables', () => {
    const root = parse(transpile(`html { @include mat.all-component-themes($theme); }`));
    const nonVarProps: string[] = [];
    root.walkDecls(decl => {
      if (!decl.prop.startsWith('--')) {
        nonVarProps.push(decl.prop);
      }
    });
    expect(nonVarProps).toEqual([]);
  });

  it('should not have overlapping tokens between theme dimensions', () => {
    const css = transpile(`
        $theme: matx.define-theme();
        base {
          @include mat.all-component-bases($theme);
        }
        color {
          @include mat.all-component-colors($theme);
        }
        typography {
          @include mat.all-component-typographies($theme);
        }
        density {
          @include mat.all-component-densities($theme);
        }
    `);
    const root = parse(css);
    const propSets: {[key: string]: Set<string>} = {};
    root.walkRules(rule => {
      rule.walkDecls(decl => {
        propSets[rule.selector] = propSets[rule.selector] || new Set();
        propSets[rule.selector].add(decl.prop);
      });
    });
    let overlap = new Set();
    for (const [dimension1, props1] of Object.entries(propSets)) {
      for (const [dimension2, props2] of Object.entries(propSets)) {
        if (dimension1 !== dimension2) {
          overlap = union(overlap, intersection(props1, props2));
        }
      }
    }
    expect([...overlap])
      .withContext('Did you forget to wrap these in `_hardcode()`?')
      .toEqual([]);
  });
});
