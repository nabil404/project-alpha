/**
 * mjml 5 ships no type declarations, and `@types/mjml` describes v4's
 * synchronous API. This covers only what `layout.ts` uses.
 */
declare module 'mjml' {
  export interface MjmlError {
    line: number;
    message: string;
    tagName: string;
    formattedMessage: string;
  }

  export interface MjmlOptions {
    fonts?: Record<string, string>;
    keepComments?: boolean;
    validationLevel?: 'strict' | 'soft' | 'skip';
    ignoreIncludes?: boolean;
    minify?: boolean;
  }

  export interface MjmlOutput {
    html: string;
    errors: MjmlError[];
  }

  export default function mjml2html(input: string, options?: MjmlOptions): Promise<MjmlOutput>;
}
