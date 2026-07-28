classdef SampleTestClass < matlab.unittest.TestCase
    methods (Test)
        function testPassing(testCase)
            testCase.verifyEqual(1+1, 2);
        end

        function testFailing(testCase)
            testCase.verifyEqual(1+1, 3);
        end

        function testIncomplete(testCase)
            testCase.assumeTrue(false);
        end
    end
end
