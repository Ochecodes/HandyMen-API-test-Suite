const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const dataPath = path.join(rootDir, 'data.json');
const collectionPath = path.join(rootDir, 'HandyMan_API_postman_collection.with_negatives.json');

const dataFile = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const data = Array.isArray(dataFile) ? dataFile[0] : dataFile;

const collection = JSON.parse(fs.readFileSync(collectionPath, 'utf8'));

const serviceName = data.serviceName || 'General Plumbing';
const firstName = data.firstName || 'Oche';
const lastName = data.lastName || 'Akor';
const address = data.address || '123 Port Harcourt Way';
const phoneNumber = data.phoneNumber || '+15550109988';
const experience = data.experience || '5';
const bio = data.bio || 'Certified handyman with expertise in plumbing and electrical work.';
const latitude = data.latitude ?? 6.455;
const longitude = data.longitude ?? 3.3942;
const email = `${(firstName || 'oche').toLowerCase()}.${(lastName || 'akor').toLowerCase()}@example.com`;
const password = 'Password123!';

function defaultValueForKey(key) {
  switch (key) {
    case 'firstName':
      return firstName;
    case 'lastName':
      return lastName;
    case 'phoneNumber':
      return phoneNumber;
    case 'experience':
      return experience;
    case 'bio':
      return bio;
    case 'address':
    case 'location':
    case 'locationAddress':
      return address;
    case 'serviceName':
    case 'category':
      return serviceName;
    case 'locationLatitude':
    case 'latitude':
      return latitude;
    case 'locationLongitude':
    case 'longitude':
      return longitude;
    case 'title':
      return `Service Request for ${serviceName}`;
    case 'description':
      return `Need help with ${serviceName}`;
    case 'reason':
      return `Need help with ${serviceName}`;
    case 'reviewMessage':
      return `Great work by ${firstName} ${lastName}`;
    case 'email':
      return email;
    case 'password':
    case 'oldPassword':
    case 'newPassword':
    case 'confirmPassword':
      return password;
    case 'newPin':
    case 'confirmPin':
      return '1234';
    case 'OTP':
      return '123456';
    case 'fcmToken':
      return 'sample-fcm-token';
    case 'tokenCategory':
      return 'EMAIL_VERIFICATION';
    case 'jobType':
      return 'SERVICE';
    case 'currency':
      return 'NGN';
    case 'profilePicUrl':
      return 'https://example.com/profile.jpg';
    case 'idVerificationUrl':
      return 'https://example.com/id-verification.jpg';
    default:
      return undefined;
  }
}

function updateValue(value, key) {
  if (Array.isArray(value)) {
    return value.map((item) => updateValue(item, key));
  }

  if (value && typeof value === 'object') {
    const updated = {};
    Object.entries(value).forEach(([childKey, childValue]) => {
      updated[childKey] = updateValue(childValue, childKey);
    });
    return updated;
  }

  if (typeof value === 'string') {
    if (value === 'sample text' || value === 'sample' || value === 'sample value') {
      return defaultValueForKey(key) ?? value;
    }
  }

  if (typeof value === 'number' && ['latitude', 'longitude', 'locationLatitude', 'locationLongitude'].includes(key)) {
    return defaultValueForKey(key);
  }

  return value;
}

function updateRawBodies(node) {
  if (!node || typeof node !== 'object') {
    return;
  }

  if (node.mode === 'raw' && typeof node.raw === 'string') {
    try {
      const parsed = JSON.parse(node.raw);
      const updated = updateValue(parsed, '');
      node.raw = JSON.stringify(updated, null, 2);
    } catch (error) {
      // Keep non-JSON raw bodies unchanged.
    }
  }

  Object.values(node).forEach((value) => {
    if (value && typeof value === 'object') {
      updateRawBodies(value);
    }
  });
}

updateRawBodies(collection);

fs.writeFileSync(collectionPath, JSON.stringify(collection, null, 2));
console.log(`Updated ${collectionPath} using data from ${dataPath}`);
