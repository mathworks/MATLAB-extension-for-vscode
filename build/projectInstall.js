const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')

/**
 * Handles installation of project dependencies, as well as any
 * necessary post-install steps.
 * 
 * This is required due to the standard `postinstall` script
 * being disabled from within `.npmrc`.
 */

const args = process.argv.slice(2)
const shouldClean = args.includes('--clean')
const cmd = shouldClean ? 'npm ci' : 'npm install'
const serverCmd = shouldClean ? 'npm run project-install-clean' : 'npm run project-install'

const projectRoot = path.resolve(__dirname, '..')
const serverPath = path.join(projectRoot, 'server')

try {
    // Install main dependencies
    console.log('Installing dependencies for MATLAB extension for VS Code...')
    execSync(cmd, {
        cwd: projectRoot,
        stdio: 'inherit'
    })

    // Check to make sure server directory exists
    if (!fs.existsSync(serverPath)) {
        console.error(`Directory not found: ${serverPath}`)
        process.exit(1)
    }

    // Install licensing GUI dependencies
    console.log(`Installing dependencies for MATLAB language server at ${serverPath}...`)
    execSync(serverCmd, {
        cwd: serverPath,
        stdio: 'inherit'
    })

    console.log('All dependencies installed successfully!')
} catch (error) {
    console.error('Error installing dependencies: ', error.message)
    process.exit(1)
}
