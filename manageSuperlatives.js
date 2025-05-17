const admin = require('firebase-admin');

// ---- CONFIGURATION ----
// IMPORTANT: Replace with the actual path to your downloaded service account key JSON file.
const SERVICE_ACCOUNT_KEY_PATH = './serviceAccountKey.json'; // Or an absolute path

// IMPORTANT: Replace with your Firestore database URL (usually found in Project settings -> General -> Project ID, then format as https://<YOUR_PROJECT_ID>.firebaseio.com or check your firebaseConfig in the client app)
// For Firestore, you usually don't need the databaseURL if your service account has the right permissions
// and you are using `admin.firestore()`. If you run into issues, you might need to specify it.
// const DATABASE_URL = 'https://<YOUR_PROJECT_ID>.firebaseio.com'; 

try {
  const serviceAccount = require(SERVICE_ACCOUNT_KEY_PATH);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    // databaseURL: DATABASE_URL // Uncomment if needed
  });
} catch (error) {
  console.error("Failed to initialize Firebase Admin SDK. Ensure SERVICE_ACCOUNT_KEY_PATH is correct and the file exists.", error);
  process.exit(1);
}

const db = admin.firestore();
const SUPERLATIVES_COLLECTION = 'superlatives';

// ---- HELPER FUNCTIONS ----

/**
 * Adds a new superlative document to Firestore.
 * @param {object} superlativeData - The data for the new superlative.
 *   Example: { title: "Most Likely to...", order: 1, nominees: [{ name: "John", image: "/img.jpg" }] }
 */
async function addSuperlative(superlativeData) {
  if (!superlativeData.title || typeof superlativeData.order !== 'number' || !Array.isArray(superlativeData.nominees)) {
    console.error('Invalid superlative data:', superlativeData);
    return null;
  }
  try {
    const docRef = await db.collection(SUPERLATIVES_COLLECTION).add(superlativeData);
    console.log(`Added superlative "${superlativeData.title}" with ID: ${docRef.id}`);
    return docRef;
  } catch (error) {
    console.error(`Error adding superlative "${superlativeData.title}":`, error);
    return null;
  }
}

/**
 * Fetches all existing superlatives.
 */
async function getAllSuperlatives() {
  try {
    const snapshot = await db.collection(SUPERLATIVES_COLLECTION).orderBy('order', 'asc').get();
    if (snapshot.empty) {
      console.log('No existing superlatives found.');
      return [];
    }
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.error("Error fetching superlatives:", error);
    return [];
  }
}

/**
 * Duplicates existing superlatives.
 * You can customize the title and order of the duplicated items.
 * @param {string} titleSuffix - Suffix to add to the title of duplicated items (e.g., " (Copy)").
 * @param {number} orderOffset - Value to add to the original order for duplicated items.
 *                               Ensure this offset doesn't create conflicting order numbers.
 */
async function duplicateAllSuperlatives(titleSuffix = " (Copy)", orderOffset = 100) {
  const existingSuperlatives = await getAllSuperlatives();
  if (existingSuperlatives.length === 0) {
    console.log("No superlatives to duplicate.");
    return;
  }

  let successCount = 0;
  let failCount = 0;

  // Find the maximum existing order to avoid conflicts more reliably if orderOffset is not large enough
  let maxOrder = 0;
  if (existingSuperlatives.length > 0) {
      maxOrder = Math.max(...existingSuperlatives.map(s => s.order), 0);
  }
  const newOrderStart = maxOrder + orderOffset;


  for (const superlative of existingSuperlatives) {
    const newSuperlativeData = {
      ...superlative, // Spread existing data (includes nominees, etc.)
      id: undefined, // Remove original ID to let Firestore generate a new one
      title: superlative.title + titleSuffix,
      order: newOrderStart + (superlative.order || 0) // Ensure original order is used as a base for offset
    };
    delete newSuperlativeData.id; // Ensure id is not carried over

    const result = await addSuperlative(newSuperlativeData);
    if (result) {
        successCount++;
    } else {
        failCount++;
    }
  }
  console.log(`Duplication complete. Successfully duplicated: ${successCount}, Failed: ${failCount}`);
}

/**
 * Deletes all superlatives from Firestore except for the one with the specified ID.
 * @param {string} exceptionId - The ID of the superlative to keep.
 */
async function deleteAllSuperlativesExceptOne(exceptionId) {
  if (!exceptionId) {
    console.error("Exception ID is required to know which superlative to keep.");
    return;
  }

  const allSuperlatives = await getAllSuperlatives();
  if (allSuperlatives.length === 0) {
    console.log("No superlatives to delete.");
    return;
  }

  let successCount = 0;
  let failCount = 0;
  let keptCount = 0;

  console.log(`Attempting to delete all superlatives except for ID: ${exceptionId}`);

  for (const superlative of allSuperlatives) {
    if (superlative.id === exceptionId) {
      console.log(`Keeping superlative: "${superlative.title}" (ID: ${superlative.id})`);
      keptCount++;
      continue;
    }
    try {
      await db.collection(SUPERLATIVES_COLLECTION).doc(superlative.id).delete();
      console.log(`Deleted superlative: "${superlative.title}" (ID: ${superlative.id})`);
      successCount++;
    } catch (error) {
      console.error(`Error deleting superlative "${superlative.title}" (ID: ${superlative.id}):`, error);
      failCount++;
    }
  }

  console.log(
    `Deletion process complete. Successfully deleted: ${successCount}, Failed: ${failCount}, Kept: ${keptCount}`
  );
}

/**
 * Duplicates the first superlative found in the collection multiple times.
 * @param {number} numberOfDuplicates - How many copies to create.
 * @param {string} titleSuffixBase - Base string to append to the title for copies (e.g., " (Copy)"). A number will be added.
 */
async function duplicateFirstSuperlativeMultipleTimes(numberOfDuplicates, titleSuffixBase = " (Copy)") {
  if (typeof numberOfDuplicates !== 'number' || numberOfDuplicates <= 0) {
    console.error("Number of duplicates must be a positive number.");
    return;
  }

  const existingSuperlatives = await getAllSuperlatives(); // Already sorted by order
  if (existingSuperlatives.length === 0) {
    console.log("No superlatives to duplicate.");
    return;
  }

  const firstSuperlative = existingSuperlatives[0];
  console.log(`Attempting to duplicate the first superlative: "${firstSuperlative.title}" (ID: ${firstSuperlative.id}), ${numberOfDuplicates} times.`);

  let successCount = 0;
  let failCount = 0;

  let maxOrder = 0;
  if (existingSuperlatives.length > 0) {
      maxOrder = Math.max(...existingSuperlatives.map(s => s.order), 0);
  }

  for (let i = 0; i < numberOfDuplicates; i++) {
    const newSuperlativeData = {
      ...firstSuperlative, // Spread existing data (includes nominees, etc.)
      id: undefined,       // Remove original ID to let Firestore generate a new one
      title: `${firstSuperlative.title}${titleSuffixBase} ${i + 1}`,
      order: maxOrder + i + 1 // Assign sequential order numbers after the current max
    };
    delete newSuperlativeData.id; // Ensure id is not carried over

    const result = await addSuperlative(newSuperlativeData);
    if (result) {
        successCount++;
    } else {
        failCount++;
    }
  }
  console.log(`Duplication of first superlative complete. Successfully duplicated: ${successCount}, Failed: ${failCount}`);
}

// ---- SCRIPT EXECUTION ----

async function main() {
  console.log("Starting superlative management script...");

  // --- Example 1: Add a new single superlative ---
  // const newSuperlative = {
  //   title: "Most Likely to Invent a Time Machine",
  //   order: 25, // Make sure this order number is unique or fits your sequence
  //   nominees: [
  //     { name: "Dr. Emmett Brown", image: "/images/docbrown.jpg" },
  //     { name: "Sarah Connor", image: "/images/sarahconnor.jpg" },
  //   ]
  // };
  // await addSuperlative(newSuperlative);

  // --- Example 2: Add multiple new superlatives ---
  // const superlativesToAdd = [
  //   { title: "Best Laugh", order: 26, nominees: [{ name: "Nominee A", image: "/images/a.jpg"}]},
  //   { title: "Most Optimistic", order: 27, nominees: [{ name: "Nominee B", image: "/images/b.jpg"}]},
  // ];
  // for (const sup of superlativesToAdd) {
  //   await addSuperlative(sup);
  // }
  
//   --- Example 3: List all current superlatives ---
//   console.log("\n--- Current Superlatives ---");
  const allSuperlatives = await getAllSuperlatives();
  allSuperlatives.forEach(s => console.log(`Order: ${s.order}, Title: ${s.title}, ID: ${s.id}`));

  // --- Example 4: Duplicate all existing superlatives ---
  // Make sure to adjust titleSuffix and orderOffset as needed.
  // The orderOffset is added to the *current maximum order* plus the original order of the item,
  // so they should all appear after your current set.
  // for (let i = 1; i < 20; i++) {
  //   await duplicateAllSuperlatives(`Question ${i + 1}`, i); // Adds " (Round 2)" to titles, offsets order
  // }

  // --- Example 5: Delete all superlatives except one ---
  // First, get all superlatives to find an ID to keep.
//   const allSuperlativesForDeletion = await getAllSuperlatives();
//   if (allSuperlativesForDeletion.length > 0) {
//     const exceptionId = allSuperlativesForDeletion[0].id; // Keep the first one as an example
//     console.log(`\n--- Deleting all superlatives except ID: ${exceptionId} ---`);
//     await deleteAllSuperlativesExceptOne(exceptionId);
//   } else {
//     console.log("No superlatives to delete or keep.");
//   }

//   console.log("\nScript finished.");
  // --- Example 6: Duplicate the first superlative 15 times ---
//   console.log("\n--- Duplicating first superlative 1 time ---");
//   await duplicateFirstSuperlativeMultipleTimes(1, " - Version"); // Creates 15 copies with " - Version X" appended to title

  console.log("\nScript finished. All explicitly called examples are done."); // Modified log message
  // The script will hang due to active Firestore listeners unless you explicitly exit.
  // For simple scripts, this is often fine. For long-running services, manage this.
  process.exit(0); 
}

main().catch(error => {
  console.error("An error occurred in the main script execution:", error);
  process.exit(1);
}); 