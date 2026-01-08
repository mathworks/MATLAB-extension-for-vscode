// Copyright 2025 The MathWorks, Inc.
import * as vet from 'vscode-extension-tester'
import { VSCodeTester } from './VSCodeTester'
import { DebuggerTester } from './DebuggerTester'

/**
 * EditorTester
 * Used to test the editor in VSCode.
*/
export class EditorTester extends vet.TextEditor {
    private readonly vs: VSCodeTester
    public readonly debugger: DebuggerTester

    public constructor (vs: VSCodeTester) {
        super()
        this.vs = vs
        this.debugger = new DebuggerTester(vs, this);
    }

    public async type (keys: string, message = ''): Promise<void> {
        console.log(`Sending keys to the editor. ${message}`);
        return await this.findElement(vet.By.className('inputarea')).sendKeys(keys);
    }

    public async assertDecorationOnLine (n: number, message = ''): Promise<void> {
        return await this.vs.poll(this.lineHasDecoration.bind(this, n), true, `Expected line ${n} to have decoration. ${message}`)
    }

    private async lineHasDecoration (n: number): Promise<boolean> {
        try {
            const lines = await this.findElements(vet.By.css('div.view-lines > div'));
            if (n < 1 || n > lines.length) return false;

            const spans = await lines[n - 1].findElements(vet.By.css('span'));
            for (const span of spans) {
                const classAttr = await span.getAttribute('class');
                if (classAttr?.includes('TextEditorDecoration')) {
                    return true;
                }
            }
            return false;
        } catch (e) {
            console.log('Error checking decoration on line:\n', e, '\nRetrying...')
            return false;
        }
    }
}
