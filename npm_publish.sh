#!/bin/bash
set -e  # Exit on error

echo "Dawn CLI Agent - NPM Publish Script"
echo "======================================"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "Error: npm is not installed"
    exit 1
fi

# Check npm authentication
echo "Checking npm authentication..."
if ! npm whoami &> /dev/null; then
    echo "Error: Not authenticated with npm"
    echo ""
    echo "Please run: npm login"
    echo "Or set NPM_TOKEN environment variable"
    exit 1
fi

NPM_USER=$(npm whoami)
echo "Authenticated as: $NPM_USER"
echo ""

# Check access to dawn-cli-agent package
echo "Verifying access to dawn-cli-agent..."
if npm access ls-packages 2>/dev/null | grep -q "dawn-cli-agent"; then
    echo "Access to dawn-cli-agent confirmed"
else
    echo "Warning: Could not verify access to dawn-cli-agent package"
    echo "   Continuing anyway - npm publish will fail if you don't have access"
fi
echo ""

# Version bump
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "Current version: $CURRENT_VERSION"
echo ""
echo "Select version bump type:"
echo "  1) patch - bug fixes (0.0.x)"
echo "  2) minor - new features (0.x.0)"
echo "  3) major - breaking changes (x.0.0)"
echo "  4) skip - keep current version"
echo ""
read -p "Enter choice (1-4): " -n 1 -r VERSION_CHOICE
echo ""

case $VERSION_CHOICE in
    1)
        echo "Bumping patch version..."
        npm version patch
        ;;
    2)
        echo "Bumping minor version..."
        npm version minor
        ;;
    3)
        echo "Bumping major version..."
        npm version major
        ;;
    4)
        echo "Skipping version bump"
        ;;
    *)
        echo "Invalid choice. Exiting."
        exit 1
        ;;
esac

NEW_VERSION=$(node -p "require('./package.json').version")
echo "Version: $NEW_VERSION"
echo ""

# Clean previous build
echo "Cleaning previous build..."
rm -rf dist
echo "Clean complete"
echo ""

# Run typecheck
echo "Running typecheck..."
npm run typecheck
echo "Typecheck passed"
echo ""

# Build the project
echo "Building project..."
npm run build
echo "Build complete"
echo ""

# Verify dist directory exists
if [ ! -d "dist" ]; then
    echo "Error: dist directory not found after build"
    exit 1
fi

# Show what will be published
echo "Files to be published:"
npm pack --dry-run
echo ""

# Confirm before publishing
read -p "Ready to publish to npm. Continue? (y/N) " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Publish cancelled"
    exit 1
fi

# Publish to npm
echo ""
echo "Publishing to npm..."
npm publish

echo ""
echo "Successfully published $(node -p "require('./package.json').name")@$(node -p "require('./package.json').version")"
echo "Done!"
