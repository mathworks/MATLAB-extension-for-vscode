// Copyright 2026 The MathWorks, Inc.
const fs = require('node:fs')
const path = require('node:path')
const { fileURLToPath, pathToFileURL } = require('node:url')
const { Report } = require('c8')
const config = require('../../../../.c8rc.json')
const { publisher, name, version } = require('../../../../package.json')

const rawDirectory = '.s/raw-coverage'
const artifactDirectory = '.s/coverage-artifact'
const downloadDirectory = '.s/coverage-artifacts'
// VS Code installs VSIX packages under a lowercase publisher/name ID.
const extensionRoot = path.resolve('.s/extensions', `${publisher.toLowerCase()}.${name.toLowerCase()}-${version}`)
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'))

// Returns normalized relative paths
function sourcePath (url) {
    // Exclude non-file URLs (e.g. node internals), but retain relative V8 URLs.
    if (!url.startsWith('file:') && !path.isAbsolute(url) && /^[a-z][a-z\d+.-]*:/i.test(url)) return null

    const source = url.startsWith('file:') ? fileURLToPath(url) : url
    const installedPath = path.isAbsolute(source) ? path.relative(extensionRoot, source) : null
    const relativePath = installedPath?.startsWith(`out${path.sep}`)
        ? installedPath
        : path.isAbsolute(source) ? path.relative(process.cwd(), source) : source
    const normalizedPath = relativePath.split(path.sep).join('/')

    return normalizedPath.startsWith('out/') && normalizedPath.endsWith('.js')
        ? normalizedPath
        : null
}

// Convert raw coverage .json files into a portable artifact for upload by each test job.
function collect () {
    fs.mkdirSync(artifactDirectory, { recursive: true })
    for (const file of fs.readdirSync(rawDirectory)) {
        if (!file.endsWith('.json')) continue
        const { result } = readJson(path.join(rawDirectory, file))
        const scripts = result
            .map(script => ({ ...script, url: sourcePath(script.url) }))
            .filter(script => script.url)

        if (scripts.length) {
            fs.writeFileSync(path.join(artifactDirectory, file), JSON.stringify({ result: scripts }))
        }
    }
}

// Merges downloaded coverage artifacts and produces reports for each result group.
async function report () {
    const artifacts = fs.readdirSync(downloadDirectory)
        .filter(name => /^coverage-(win64|glnxa64|maci64|maca64)-test-/.test(name))
    if (!artifacts.length) throw new Error('No coverage artifacts were downloaded.')

    // All matrix jobs have the same transpiled JavaScript code
    const firstPlatform = artifacts[0].split('-')[1]
    fs.cpSync(path.join(downloadDirectory, `${firstPlatform}-build-artifact`, 'out'), 'out', { recursive: true })

    // c8 applies exclusions to each source in a webpack map before remapping.
    // Resolve those paths on this runner so uncovered ranges aren't discarded.
    for (const file of fs.readdirSync('out').filter(file => file.endsWith('.js.map'))) {
        const mapPath = path.resolve('out', file)
        const sourceMap = readJson(mapPath)
        sourceMap.sources = sourceMap.sources.map(source => path.resolve(path.dirname(mapPath), source))
        fs.writeFileSync(mapPath, JSON.stringify(sourceMap))
    }

    const groups = new Set(['overall'])
    for (const artifact of artifacts) {
        const [, platform, , type] = artifact.split('-')
        // Publish platform-specific, test-type, and combined reports from each artifact.
        const artifactGroups = [platform, `${platform}-${type}`, 'overall']
        for (const group of artifactGroups) groups.add(group)
        const directory = path.join(downloadDirectory, artifact)

        // Distribute coverage into various "artifactGroups".
        for (const file of fs.readdirSync(directory)) {
            const coverage = readJson(path.join(directory, file))
            for (const script of coverage.result) {
                // Convert to proper absolute file URLs
                script.url = pathToFileURL(path.resolve(script.url)).href
            }
            for (const group of artifactGroups) {
                const destination = path.join(rawDirectory, group)
                fs.mkdirSync(destination, { recursive: true })
                fs.writeFileSync(path.join(destination, `${artifact}-${file}`), JSON.stringify(coverage))
            }
        }
    }

    for (const group of groups) {
        // Create a report for each group
        await Report({
            ...config,
            resolve: process.cwd(),
            omitRelative: true,
            excludeAfterRemap: config['exclude-after-remap'],
            skipFull: config['skip-full'],
            tempDirectory: path.join(rawDirectory, group),
            reportsDirectory: `.s/reports/${group}`,
            reporter: group === 'overall' ? ['html', 'json-summary', 'lcovonly'] : ['html', 'json-summary']
        }).run()
    }
}

async function main () {
    switch (process.argv[2]) {
        case 'collect': collect(); break
        case 'report': await report(); break
        default: throw new Error('Usage: node src/test/tools/utils/prepareCoverageReports.js collect|report')
    }
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
