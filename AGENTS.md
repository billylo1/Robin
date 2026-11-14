### Cross-Repo Fact-Checking Sync
Whenever fact-checking prompts, schemas, or citation/grounding logic change here (`ios/Robin/Services/GenerativeAIService.swift`, `android/app/src/main/java/org/evergreenlabs/robin/firebase/GenerativeAIService.kt`), also check and sync the corresponding implementations in:
- **Simplifier** (`/Users/billylo/web/Simplifier`): `extension/browser-utils.js`, `extension/fact-check-core.js` (and `safari-app/` copies)
- **Hopper** (`/Users/billylo/xcode/Hopper`): `Hopper/Services/GenerativeAIService.swift` and `android/app/src/main/java/org/evergreenlabs/hopper/firebase/GenerativeAIService.kt`
