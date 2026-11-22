#!/usr/bin/env bash
set -euo pipefail

# Replies to the official Homey Community thread (https://community.homey.app/t/app-pro-roku/162541)
# whenever a new test version is published.
#
# Required environment variables (for automated Discourse API posting):
#   DISCOURSE_API_KEY       - Discourse API Key or User API Key for community.homey.app
#   DISCOURSE_API_USERNAME  - Discourse username (default: Thomas_Veivag)

TOPIC_ID="162541"
TOPIC_URL="https://community.homey.app/t/app-pro-roku/162541"
VERSION=$(jq -r '.version' app.json)
CHANGELOG=$(jq -r --arg v "$VERSION" '.[$v].en // "Bug fixes and improvements."' .homeychangelog.json)

POST_RAW=$(cat <<EOF
### :rocket: New Test Version Published: **v${VERSION}** (Roku Community)

A new test build (**v${VERSION}**) is now live on the Homey App Store test channel!

- :point_right: **Install Test Version:** [Roku (Community) v${VERSION} (Test)](https://homey.app/a/com.roku/test/)
- :octocat: **Source & Release Notes:** [GitHub Release v${VERSION}](https://github.com/snurre66/roku-homey-app/releases/tag/v${VERSION})

#### :memo: What's New in v${VERSION}
- ${CHANGELOG}

#### :gear: Reminder for Roku OS 11.5+ Users
If remote commands return \`HTTP 403 Forbidden\`, make sure local network control is set to **Permissive** on your Roku device:
\`Settings → System → Advanced system settings → Control by mobile apps → Permissive\`
EOF
)

echo "================================================================="
echo "Homey Community Forum Post (Topic: ${TOPIC_URL})"
echo "================================================================="
echo "${POST_RAW}"
echo "================================================================="

if [[ -n "${DISCOURSE_API_KEY:-}" ]]; then
  USERNAME="${DISCOURSE_API_USERNAME:-Thomas_Veivag}"
  echo "Posting reply to ${TOPIC_URL} as ${USERNAME}..."
  PAYLOAD=$(jq -n --arg tid "${TOPIC_ID}" --arg raw "${POST_RAW}" '{topic_id: ($tid | tonumber), raw: $raw}')
  curl -sS -f -X POST "https://community.homey.app/posts.json" \
    -H "Content-Type: application/json" \
    -H "Api-Key: ${DISCOURSE_API_KEY}" \
    -H "Api-Username: ${USERNAME}" \
    -d "${PAYLOAD}"
  echo ""
  echo "✓ Successfully posted reply to ${TOPIC_URL}"
else
  echo "Tip: Copy the markdown above to reply at ${TOPIC_URL}"
  echo "     or set DISCOURSE_API_KEY to post automatically."
fi
