# VESSEL Studio

小説の自動生成 → KDP入稿 → 漫画化 → 表紙生成 → SNS宣伝まで、AI出版の全工程を管理するWebアプリ。

## 必要なAPIキー

- **Anthropic API Key**（必須）— 小説生成、KDPメタデータ、漫画プロンプト、X投稿文の全機能に必要
  - 取得: https://console.anthropic.com/settings/keys
- **OpenAI API Key**（表紙生成に必要）— GPT Image 2による表紙画像生成に必要
  - 取得: https://platform.openai.com/api-keys

## ローカルで動かす

```bash
npm install
npm run dev
```

ブラウザで http://localhost:5173 を開く。

## Vercelにデプロイする手順

### 1. GitHubリポジトリを作成

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/vessel-studio.git
git push -u origin main
```

### 2. Vercelに接続

1. https://vercel.com にアクセス（GitHubアカウントでログイン）
2. 「New Project」をクリック
3. GitHubリポジトリ「vessel-studio」を選択
4. Framework: **Vite** を選択（自動検出される場合が多い）
5. 「Deploy」をクリック

### 3. 完了

数分でデプロイが完了し、`https://vessel-studio-xxx.vercel.app` のようなURLが発行されます。

このURLを共有すれば、誰でもVESSEL Studioを使えます。  
各ユーザーは自分のAPIキーをSettingsタブで設定して使用します。

## カスタムドメインを設定する場合

1. Vercelのプロジェクト設定 → Domains
2. 好きなドメイン（例: vessel-studio.com）を追加
3. ドメインのDNS設定で、VercelのCNAMEレコードを追加

## 技術スタック

- React 18 + Vite
- Anthropic Claude API（小説・テキスト生成）
- OpenAI GPT Image API（表紙画像生成）
- localStorage（データ永続化）

## セキュリティについて

- APIキーはブラウザのlocalStorageに保存され、各APIへの直接通信にのみ使用されます
- サーバーにAPIキーが送信されることはありません
- 各ユーザーが自分のAPIキーを使用するため、課金は個人に紐づきます
