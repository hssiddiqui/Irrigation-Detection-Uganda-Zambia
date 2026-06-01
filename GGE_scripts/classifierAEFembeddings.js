// Prompt: "Write GEE script to filter AlphaEarth embeddings for Uganda and year 2023.
// Load irrigated and non-irrigated survey points from Assets. Train a random forest classifier.
// Classify the embeddings image and run an accuracy assessment and print accuracy scores."
/////////////////////////////////////////////////////////////////////////////////////

// Select the region
// ****************************************************

var geometry = ee.FeatureCollection("FAO/GAUL/2015/level0")
              .filter(ee.Filter.eq('ADM0_NAME','Uganda'));

Map.centerObject(geometry, 8);
Map.setOptions('SATELLITE');

var snazzy = require("users/aazuspan/snazzy:styles");
snazzy.addStyle("https://snazzymaps.com/style/15/subtle-grayscale", "Subtle Grayscale");
var bg = ee.Image(1)
Map.addLayer(bg, {palette:['ffffff']}, 'white',false)

// Prepare the Satellite Embedding dataset
// ****************************************************

var embeddings = ee.ImageCollection('GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL');

var year = 2023;
var startDate = ee.Date.fromYMD(year, 1, 1);
var endDate = startDate.advance(1, 'year');

var filteredembeddings = embeddings
  .filter(ee.Filter.date(startDate, endDate))
  .filter(ee.Filter.bounds(geometry));

var hand = ee.Image('users/gena/GlobalHAND/30m/hand-1000').rename('hand')
var embeddingsImage = filteredembeddings.mosaic()
// .addBands(hand);


var irrig = ee.FeatureCollection("users/HSSiddiqui/Uganda/UGD_irrig_int_sample");
var nonirrig = ee.FeatureCollection("users/HSSiddiqui/Uganda/UGD_nonirrig_int");

var gcps =
  irrig.map(function (feature) {
    return feature.set('class', 1);
  })
  .merge(
    nonirrig.map(function (feature) {
      return feature.set('class', 0);
    })
  );
  
// Add a random column and split the GCPs into training and validation set
var gcp = gcps.randomColumn()

var trainingGcp = gcp.filter(ee.Filter.lt('random', 0.7));
var validationGcp = gcp.filter(ee.Filter.gte('random', 0.7));

// Overlay the point on the image to get training data.
var training = embeddingsImage.sampleRegions({
  collection: trainingGcp,
  properties: ['class'],
  scale: 10,
  tileScale: 16
});

// Train a classifier.
var classifier = ee.Classifier.smileRandomForest(50)
.train({
  features: training,  
  classProperty: 'class',
  inputProperties: embeddingsImage.bandNames()
})
// .setOutputMode('PROBABILITY');

// // Classify the image.
// var classified = embeddingsImage.classify(classifier);

// var palettes = require('users/gena/packages:palettes');
// var palette = palettes.colorbrewer.PRGn[11];
// Map.addLayer(classified.clip(geometry), {min: 0.5, max: 1, palette: palette}, 'Irrigation Classification');

// Classify the image.
var classified = embeddingsImage.classify(classifier);

// Get information about the trained classifier.
// print('Results of trained classifier', classifier.explain());

Map.addLayer(classified.clip(geometry), {min: 0, max: 1, palette: ['black','green']}, 'Irrigation Classification',false);

//************************************************************************** 
// Accuracy Assessment
//************************************************************************** 
var validation = embeddingsImage.sampleRegions({
  collection: validationGcp,
  properties: ['class'],
  scale: 10,
  tileScale: 16
});

var test = validation.classify(classifier);

var testConfusionMatrix = test.errorMatrix('class', 'classification')
// Printing of confusion matrix may time out. Alternatively, you can export it as CSV
print('Confusion Matrix', testConfusionMatrix);
print('Test Accuracy', testConfusionMatrix.accuracy());
print('Producers Accuracy', testConfusionMatrix.producersAccuracy());
print('Consumers Accuracy', testConfusionMatrix.consumersAccuracy());
print('Kappa Coefficient', testConfusionMatrix.kappa());
print('F1', testConfusionMatrix.fscore());

// ... [Keep your existing code up to the training section] ...

// 1. Define the Linear Probe Classifier
// We use a Linear SVM or Logistic Regression to act as the "Linear Probe"
// This evaluates if the embeddings are linearly separable.
var linearProbe = ee.Classifier.libsvm({
  svmType: 'C_SVC',
  kernelType: 'LINEAR', // This makes it a "Linear" probe
  cost: 10
});

// Alternatively, you can use smileLogisticRegression for a standard logit probe:
// var linearProbe = ee.Classifier.smileLogisticRegression();

// 2. Train the Linear Probe
var trainedProbe = linearProbe.train({
  features: training,  
  classProperty: 'class',
  inputProperties: embeddingsImage.bandNames()
});

// 3. Classify the image using the Linear Probe
var classifiedProbe = embeddingsImage.classify(trainedProbe);

// 4. Add the Linear Probe result to the Map
Map.addLayer(classifiedProbe.clip(geometry), 
  {min: 0, max: 1, palette: ['black', 'green']}, 
  'Linear Probe: Irrigation');
  
// Mask out area with permanent/semi-permanent water
var permanentWater = gsw.select('seasonality').gte(4).clip(geometry)
Map.addLayer(permanentWater.selfMask(), {min:0, max:1, palette: ['white']}, 'Permanent Water')

//************************************************************************** // Accuracy Assessment for Linear Probe
//************************************************************************** // Sample the validation regions
var validation = embeddingsImage.sampleRegions({
  collection: validationGcp,
  properties: ['class'],
  scale: 10,
  tileScale: 16
});

var testProbe = validation.classify(trainedProbe);

var probeConfusionMatrix = testProbe.errorMatrix('class', 'classification');

// print('--- Linear Probe Results ---');
// print('Confusion Matrix', probeConfusionMatrix);
// print('Overall Accuracy', probeConfusionMatrix.accuracy());
// print('Producers Accuracy', probeConfusionMatrix.producersAccuracy());
// print('Consumers Accuracy', probeConfusionMatrix.consumersAccuracy());
// print('Kappa Coefficient', probeConfusionMatrix.kappa());
// print('F1 Score', probeConfusionMatrix.fscore());
