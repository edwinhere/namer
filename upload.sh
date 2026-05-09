#!/bin/bash
# Upload script for Namer model v2.0
# This script pushes the updated model to GitHub and HuggingFace

set -e

echo "=== Namer v2.0 Upload Script ==="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Verify files exist
echo -e "${YELLOW}Step 1: Verifying files...${NC}"
required_files=("README.md" "CHANGELOG.md" "config.json" "model.safetensors" "modeling_namer.py" "namer_model.pt")
for file in "${required_files[@]}"; do
    if [ ! -f "$file" ]; then
        echo "ERROR: Required file '$file' not found!"
        exit 1
    fi
    echo "  ✓ $file"
done

# Step 2: Run tests
echo ""
echo -e "${YELLOW}Step 2: Running tests...${NC}"
source .venv/bin/activate
python -m namer test

# Step 3: Copy HF README
echo ""
echo -e "${YELLOW}Step 3: Preparing HuggingFace README...${NC}"
cp README_HF.md README.md.tmp
cp README.md README.md.git
cp README_HF.md README.md
echo "  ✓ Copied README_HF.md to README.md for HF upload"

# Step 4: Commit and push to GitHub
echo ""
echo -e "${YELLOW}Step 4: Pushing to GitHub...${NC}"
git add -A
git commit -m "Namer v2.0: Support for trillions with stratified training

- Extended range from millions to trillions (0-999,999,999,999)
- Added stratified sampling for balanced training across scales
- Increased max_output_len from 20 to 25 tokens
- Updated documentation and added CHANGELOG
- All tests passing"
git push origin main
echo "  ✓ Pushed to GitHub"

# Step 5: Push to HuggingFace
echo ""
echo -e "${YELLOW}Step 5: Pushing to HuggingFace...${NC}"
git push hf main
echo "  ✓ Pushed to HuggingFace"

# Step 6: Restore GitHub README
echo ""
echo -e "${YELLOW}Step 6: Restoring GitHub README...${NC}"
mv README.md.tmp README.md
echo "  ✓ Restored"

echo ""
echo -e "${GREEN}=== Upload Complete! ===${NC}"
echo ""
echo "Model is now available at:"
echo "  - GitHub: https://github.com/edwinhere/namer"
echo "  - HuggingFace: https://huggingface.co/edwinhere/namer"
