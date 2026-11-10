# Mr. Pinbot for Chrome

1. Run the Mr. Pinbot app locally with `npm run dev` from the repository root. Configure the app's existing Supabase and OpenAI environment variables and sign in as the library owner. For local magic links, Supabase must allow the local callback and the sign-in flow must redirect there.
2. In `extension/background.js`, change the app origin to `http://localhost:3000` for local testing.
3. Open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**, and select this `extension` folder. Reload the extension there after changes.
4. Right-click a product image and choose the Mr. Pinbot action. Check the image, edit the title as needed, and paste your ShopMy affiliate link. If the site does not allow the image to be read, select a local copy in the form.
5. Save the Draft. Check your Content Library for the new card; the description may take a moment to appear. The extension does not schedule or publish Pins.

Use the production app origin only after the matching capture page and server route have been deployed.
