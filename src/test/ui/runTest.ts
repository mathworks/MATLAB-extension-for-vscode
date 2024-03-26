// Copyright 2023-2024 The MathWorks, Inc.
import { TestSuite } from './../tools/tester/TestSuite'

async function main (): Promise<void> {
    const testSuite = new TestSuite()

    // or run all tests in test/ui directory
    const tests = testSuite.getTestList()

    await testSuite.enqueueTests(tests)
}

void main()
