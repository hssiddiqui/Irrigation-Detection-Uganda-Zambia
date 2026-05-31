// Add two maps to the screen.
var left = ui.Map();
var right = ui.Map();
ui.root.clear();
ui.root.add(left);
ui.root.add(right);

// Link maps, so when you drag one map, the other will be moved in sync.
ui.Map.Linker([left, right], 'change-bounds');
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Section 1 - Load species data, AOI, and remove duplicates
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Load data
var irrig = ee.FeatureCollection("users/HSSiddiqui/Uganda/UGD_irrig_int_sample")
// .randomColumn().sort('random').limit(10000);
var nonirrig = ee.FeatureCollection("users/HSSiddiqui/Uganda/UGD_nonirrig_int");

//Define the AOI
var AOI = ee.FeatureCollection("FAO/GAUL/2015/level0")
              .filter(ee.Filter.eq('ADM0_NAME','Uganda'));

// Define spatial resolution to work with (m)
var GrainSize = 10;

var gcps =
  irrig.map(function (feature) {
    return feature.set('class', 1);
  })
  .merge(
    nonirrig.map(function (feature) {
      return feature.set('class', 0);
    })
  );
  
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Section 2 - Selecting Predictor Variables
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
var hand = ee.Image('users/gena/GlobalHAND/30m/hand-1000')
var srtmMtpi = ee.Image("CSP/ERGo/1_0/Global/SRTM_mTPI").select('elevation').rename('SRTMmtpi');
var tEMs = ee.Image('users/HSSiddiqui/Uganda/UGD_tEMs_2023_10m')
var DHRSL = ee.Image('users/HSSiddiqui/Uganda/DHRSL')
var DNLT = ee.Image('users/HSSiddiqui/Uganda/DNLT')
var LSTN = ee.Image('users/HSSiddiqui/Uganda/LSTN')
var LSTD = ee.Image('users/HSSiddiqui/Uganda/LSTD')
var EVI = ee.Image('users/HSSiddiqui/Uganda/EVI')
var DIPA = ee.Image('users/HSSiddiqui/Uganda/DIPA')
var MLON = ee.Image('users/HSSiddiqui/Uganda/MLON')
var MLAT = ee.Image('users/HSSiddiqui/Uganda/MLAT')
var BIO1 = ee.Image('users/HSSiddiqui/Uganda/BIO1')
var BIO7 = ee.Image('users/HSSiddiqui/Uganda/BIO7')
var BIO12 = ee.Image('users/HSSiddiqui/Uganda/BIO12')
var BIO15 = ee.Image('users/HSSiddiqui/Uganda/BIO15')


// #############################################################################
// Import LST image collection.
var modis = ee.ImageCollection('MODIS/061/MOD11A2');

// Define a date range of interest; here, a start date is defined and the end
// date is determined by advancing 1 year from the start date.
var start = ee.Date('2023-01-01');
var dateRange = ee.DateRange(start, start.advance(1, 'year'));

// Filter the LST collection to include only images intersecting the desired
// date range.
var mod11a2 = modis.filterDate(dateRange);

// Select only the 1km day LST data band.
var modLSTday = mod11a2.select('LST_Day_1km');

// Scale to Kelvin and convert to Celsius, set image acquisition time.
var modLSTc = modLSTday.map(function(img) {
  return img
    .multiply(0.02)
    .subtract(273.15)
    .copyProperties(img, ['system:time_start']);
});


var clippedLSTc = modLSTc.mean().clip(AOI);

// Add clipped image layer to the map.
Map.addLayer(clippedLSTc, {
  min: 20, max: 40,
  palette: ['blue', 'limegreen', 'yellow', 'darkorange', 'red']},
  'Mean temperature, 2015',false);
  
var imageCollection = ee.ImageCollection('COPERNICUS/S2_SR').filterBounds(AOI);

//Sentinel Cloud Masking Function
function maskCloudAndShadowsSR(image) {
  var cloudProb = image.select('MSK_CLDPRB');
  var snowProb = image.select('MSK_SNWPRB');
  var cloud = cloudProb.lt(5);
  var snow = snowProb.lt(5);
  var scl = image.select('SCL'); 
  var shadow = scl.eq(3); // 3 = cloud shadow
  var cirrus = scl.eq(10); // 10 = cirrus
  // Cloud probability less than 5% or cloud shadow classification
  var mask = (cloud.and(snow)).and(cirrus.neq(1)).and(shadow.neq(1));
  return image.updateMask(mask)
      .select("B.*")
      .copyProperties(image, ["system:time_start"]);
}

// create list of size n for number of desired months
var monthCount = ee.List.sequence(0, 3);
// run through the image collection and generate monthly median images
var composites = ee.ImageCollection.fromImages(monthCount.map(function(m) {
  //set start date
  var startMonth = 1; 
  var startYear = ee.Number(2023); 
  var startDate = ee.Date.fromYMD(startYear, startMonth, 1).advance(m,'month');
  //set end date to one month after start date
  var endDate = startDate.advance(1, 'month');
  //filter collection to images between start and end date
  var filtered = imageCollection.filterDate(startDate, endDate);
  
  // mask for clouds and then take the monthly median composite
  var composite = filtered.map(maskCloudAndShadowsSR).median();
  return composite
      .set('month', startDate)
      .set('system:time_start', startDate.millis());
}));

var vis = {bands: ['B4', 'B3', 'B2'], min: 0, max: 3500};

// Replace masked pixels by the mean of the previous and next months 
var replacedVals = composites.map(function(image){
  var currentDate = ee.Date(image.get('system:time_start'));
  // create mean image which is derived from the two months before and after the current month
  var meanImage = composites.filterDate(
                currentDate.advance(-2, 'month'), currentDate.advance(2, 'month')).mean();
  // replace all masked values:
  return meanImage.where(image, image);
});


//Add EVI band to each image in the collection
var addEVI = function(image){
  var evi = image.expression('2.5 * ((NIR - RED) / (1 + NIR + 6 * RED - 7.5 * BLUE))',
    {'NIR': image.select('B8').divide(10000),
     'RED': image.select('B4').divide(10000),
     'BLUE': image.select('B2').divide(10000)});
     return image.addBands(evi);
};

//rename EVI band
var s2EVI = replacedVals.map(addEVI);
var s2EVI = s2EVI.select(['constant'],['EVI']);


//Unstack the collection into a single image with one band for each month
var composite = s2EVI.select('EVI').toBands();
var composite = composite.addBands(hand); 
// var composite = composite.addBands(clippedLSTc)
var composite = composite.addBands(tEMs)
// var composite = hand.addBands(tEMs)
var composite = composite.addBands(DHRSL)
var composite = composite.addBands(DNLT)
var composite = composite.addBands(DIPA)
var composite = composite.addBands(LSTN)
var composite = composite.addBands(LSTD)
var composite = composite.addBands(EVI)
var composite = composite.addBands(MLAT)
var composite = composite.addBands(MLON)
var composite = composite.addBands(BIO1)
var composite = composite.addBands(BIO7)
var composite = composite.addBands(BIO12)
var composite = composite.addBands(BIO15)
var predictors = composite.addBands(srtmMtpi);

// Get band names
var bands = predictors.bandNames();
  
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Section 3 - Defining spatial blocks for model fitting and cross validation
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

var Data = ee.FeatureCollection("users/HSSiddiqui/Uganda/UGD_irrig_int")

// Spatially constrained pseudo-absence selection to a buffer around presence points.
var buffer = 5000; // Distance in meters.
var mask = ee.Image(1).clip(AOI);
var bufferGeom = Data.geometry().buffer(buffer, 1000);

// 1. Create a binary image of the buffer (1 inside, 0 outside)
var bufferImage = ee.Image(0).byte().paint(bufferGeom, 1);
// 2. Invert the buffer image: 1 becomes 0 (the hole), and 0 becomes 1 (the outside)
var outsideBuffer = bufferImage.not();
// 3. Update your original mask to only show the "1" values (the area outside)
var AreaForPA = mask.updateMask(outsideBuffer);

Map.addLayer(AreaForPA, {palette: 'black'},'Area to create pseudo-absences', 0);


// Define a function to create a grid over AOI
function makeGrid(Geometry, scale) {
  // pixelLonLat returns an image with each pixel labeled with longitude and
  // latitude values.
  var lonLat = ee.Image.pixelLonLat();
  // Select the longitude and latitude bands, multiply by a large number then
  // truncate them to integers.
  var lonGrid = lonLat
    .select('longitude')
    .multiply(100000)
    .toInt();
  var latGrid = lonLat
    .select('latitude')
    .multiply(100000)
    .toInt();
  return lonGrid
    .multiply(latGrid)
    .reduceToVectors({
      geometry: Geometry, //Buffer to expand grid and include borders
      scale: scale,
      geometryType: 'polygon',
    });
}
// Create grid and remove cells outside AOI
var Scale = 50000; // Set range in m to create spatial blocks
var Grid = makeGrid(AOI, Scale);
Map.addLayer(Grid, {},'Grid for spatail block cross validation', 0);


///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Section 4 - Fitting SDM models
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Define SDM function
// Activate the desired classifier, random forest or gradient boosting. 
// Note that other algorithms are available in GEE. See ee.Classifiers on the documentation for more information.

function SDM(x) {
    var Seed = ee.Number(x);
    // Randomly split blocks for training and validation
    var GRID = ee.FeatureCollection(Grid).randomColumn({seed:Seed}).sort('random');
    var TrainingGrid = GRID.filter(ee.Filter.lt('random', split));  // Filter points with 'random' property < split percentage
    var TestingGrid = GRID.filter(ee.Filter.gte('random', split));  // Filter points with 'random' property >= split percentage

    // Presence
    var PresencePoints = ee.FeatureCollection("users/HSSiddiqui/Uganda/UGD_irrig_int");
    PresencePoints = PresencePoints.map(function(feature){return feature.set('PresAbs', 1)});
    var TrPresencePoints = PresencePoints.filter(ee.Filter.bounds(TrainingGrid));  // Filter points with 'random' property < split percentage
    var TePresencePoints = PresencePoints.filter(ee.Filter.bounds(TestingGrid));  // Filter points with 'random' property >= split percentage
    
    // Presence
    var AbsencePoints = ee.FeatureCollection("users/HSSiddiqui/Uganda/UGD_nonirrig_int");
    AbsencePoints = AbsencePoints.map(function(feature){return feature.set('PresAbs', 0)});
    var TrAbsencePoints = AbsencePoints.filter(ee.Filter.bounds(TrainingGrid));  // Filter points with 'random' property < split percentage
    var TeAbsencePoints = AbsencePoints.filter(ee.Filter.bounds(TestingGrid));  // Filter points with 'random' property >= split percentage

    // Pseudo-absences
    var TrPseudoAbsPoints = AreaForPA.sample({region: TrainingGrid, scale: GrainSize, numPixels: 11000, seed:Seed, geometries: true, tileScale: 16}); // We add extra points to account for those points that land in masked areas of the raster and are discarded. This ensures a balanced presence/pseudo-absence data set
    // TrPseudoAbsPoints = TrPseudoAbsPoints.randomColumn().sort('random').limit(ee.Number(TrPresencePoints.size())); //Randomly retain the same number of pseudo-absences as presence data 
    TrPseudoAbsPoints = TrPseudoAbsPoints.map(function(feature){
        return feature.set('PresAbs', 0);
        });
 
    var TePseudoAbsPoints = AreaForPA.sample({region: TestingGrid, scale: GrainSize, numPixels: 5000, seed:Seed, geometries: true, tileScale: 16}); // We add extra points to account for those points that land in masked areas of the raster and are discarded. This ensures a balanced presence/pseudo-absence data set
    // TePseudoAbsPoints = TePseudoAbsPoints.randomColumn().sort('random').limit(ee.Number(TePresencePoints.size())); //Randomly retain the same number of pseudo-absences as presence data 
    TePseudoAbsPoints = TePseudoAbsPoints.map(function(feature){
        return feature.set('PresAbs', 0);
        });

    // Merge points
    var trainingPartition = TrPresencePoints.merge(TrAbsencePoints).merge(TrPseudoAbsPoints);
    var testingPartition = TePresencePoints.merge(TeAbsencePoints).merge(TePseudoAbsPoints);

    // Extract local covariate values from multiband predictor image at training points
    var trainPixelVals = predictors.sampleRegions({collection: trainingPartition, properties: ['PresAbs'], scale: GrainSize, tileScale: 16, geometries: false});

    // Classify using random forest
    var Classifier = ee.Classifier.smileRandomForest({
      numberOfTrees: 500, //The number of decision trees to create.
      variablesPerSplit: null, //The number of variables per split. If unspecified, uses the square root of the number of variables.
      minLeafPopulation: 10,//Only create nodes whose training set contains at least this many points. Integer, default: 1
      bagFraction: 0.5,//The fraction of input to bag per tree. Default: 0.5.
      maxNodes: null,//The maximum number of leaf nodes in each tree. If unspecified, defaults to no limit.
      seed: Seed//The randomization seed.
      });
  
    // Presence probability 
    var ClassifierPr = Classifier.setOutputMode('PROBABILITY').train(trainPixelVals, 'PresAbs', bands); 
    var ClassifiedImgPr = predictors.select(bands).classify(ClassifierPr);

    // // Binary presence/absence map
    // var ClassifierBin = Classifier.setOutputMode('CLASSIFICATION').train(trainPixelVals, 'PresAbs', bands); 
    // var ClassifiedImgBin = predictors.select(bands).classify(ClassifierBin);
   
    // return ee.List([ClassifiedImgPr, ClassifiedImgBin, trainingPartition, testingPartition]);
   
    return ee.List([ClassifiedImgPr, testingPartition]);
}


// Define partition for training and testing data
var split = 0.70;  // The proportion of the blocks used to select training data

// Define number of repetitions
var numiter = 5;

// Define function to generate a vector of random numbers between 1 and 1000
function runif(length) {
    return Array.apply(null, Array(length)).map(function() {
        return Math.round(Math.random() * (1000 - 1) + 1)
    });
}

// Fit SDM 
//var RanSeeds = runif(numiter)
//var results = ee.List(RanSeeds).map(SDM)

// While the runif function can be used to generate random seeds, we map the SDM function over random created numbers for reproducibility of results
var results = ee.List([55,7,25,65,23]).map(SDM);

// Extract results from list
var results = results.flatten();

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Section 5 - Extracting and displaying model prediction results
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Habitat suitability

// Extract all model predictions
var images = ee.List.sequence(0,ee.Number(numiter).multiply(2).subtract(1),2).map(function(x){
  return results.get(x)});

// Calculate mean of all individual model runs
var ModelAverage = ee.ImageCollection.fromImages(images).mean();

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Section 6 - Accuracy assessment
///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Extract testing/validation datasets
var TestingDatasets = ee.List.sequence(1,ee.Number(numiter).multiply(2).subtract(1),2).map(function(x){
                      return results.get(x)});

// Double check that you have a satisfactory number of points for model validation
// print('Number of presence and pseudo-absence points for model validation', ee.List.sequence(0,ee.Number(numiter).subtract(1),1)
// .map(function(x){
//   return ee.List([ee.FeatureCollection(TestingDatasets.get(x)).filter(ee.Filter.eq('PresAbs',1)).size(),
//         ee.FeatureCollection(TestingDatasets.get(x)).filter(ee.Filter.eq('PresAbs',0)).size()]);
// })
// );

// Define functions to estimate sensitivity, specificity and precision.
function getAcc(img,TP){
  var Pr_Prob_Vals = img.sampleRegions({collection: TP, properties: ['PresAbs'], scale: GrainSize, tileScale: 16});
  var seq = ee.List.sequence({start: 0, end: 1, count: 25});
  return ee.FeatureCollection(seq.map(function(cutoff) {
  var Pres = Pr_Prob_Vals.filterMetadata('PresAbs','equals',1);
  // true-positive and true-positive rate, sensitivity  
  var TP =  ee.Number(Pres.filterMetadata('classification','greater_than',cutoff).size());
  var TPR = TP.divide(Pres.size());
  var Abs = Pr_Prob_Vals.filterMetadata('PresAbs','equals',0);
  // false-negative
  var FN = ee.Number(Pres.filterMetadata('classification','less_than',cutoff).size());
  // true-negative and true-negative rate, specificity  
  var TN = ee.Number(Abs.filterMetadata('classification','less_than',cutoff).size());
  var TNR = TN.divide(Abs.size());
  // false-positive and false-positive rate
  var FP = ee.Number(Abs.filterMetadata('classification','greater_than',cutoff).size());
  var FPR = FP.divide(Abs.size());
  // precision
  var Precision = TP.divide(TP.add(FP));
  // sum of sensitivity and specificity
  var SUMSS = TPR.add(TNR);
  return ee.Feature(null,{cutoff: cutoff, TP:TP, TN:TN, FP:FP, FN:FN, TPR:TPR, TNR:TNR, FPR:FPR, Precision:Precision, SUMSS:SUMSS});
  }));
}

// Calculate AUC of the Receiver Operator Characteristic
function getAUCROC(x){
  var X = ee.Array(x.aggregate_array('FPR'));
  var Y = ee.Array(x.aggregate_array('TPR')); 
  var X1 = X.slice(0,1).subtract(X.slice(0,0,-1));
  var Y1 = Y.slice(0,1).add(Y.slice(0,0,-1));
  return X1.multiply(Y1).multiply(0.5).reduce('sum',[0]).abs().toList().get(0);
}

function AUCROCaccuracy(x){
  var HSM = ee.Image(images.get(x));
  var TData = ee.FeatureCollection(TestingDatasets.get(x));
  var Acc = getAcc(HSM, TData);
  return getAUCROC(Acc);
}


var AUCROCs = ee.List.sequence(0,ee.Number(numiter).subtract(1),1).map(AUCROCaccuracy);

// Calculate AUC of Precision Recall Curve

function getAUCPR(roc){
  var X = ee.Array(roc.aggregate_array('TPR'));
  var Y = ee.Array(roc.aggregate_array('Precision')); 
  var X1 = X.slice(0,1).subtract(X.slice(0,0,-1));
  var Y1 = Y.slice(0,1).add(Y.slice(0,0,-1));
  return X1.multiply(Y1).multiply(0.5).reduce('sum',[0]).abs().toList().get(0);
}

function AUCPRaccuracy(x){
  var HSM = ee.Image(images.get(x));
  var TData = ee.FeatureCollection(TestingDatasets.get(x));
  var Acc = getAcc(HSM, TData);
  return getAUCPR(Acc);
}

var AUCPRs = ee.List.sequence(0,ee.Number(numiter).subtract(1),1).map(AUCPRaccuracy);

// Function to extract other metrics
function getMetrics(x){
  var HSM = ee.Image(images.get(x));
  var TData = ee.FeatureCollection(TestingDatasets.get(x));
  var Acc = getAcc(HSM, TData);
  return Acc.sort({property:'SUMSS',ascending:false}).first();
}

// Extract sensitivity, specificity and mean threshold values
var Metrics = ee.List.sequence(0,ee.Number(numiter).subtract(1),1).map(getMetrics);

///////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// Section 7 - Export outputs
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Export final outputs to Google Drive

Export.image.toDrive({
  image: ModelAverage, //Object to export
  description: 'HSI', //Name of the file
  scale: GrainSize, //Spatial resolution of the exported raster
  maxPixels: 1e10,
  region: AOI //Area of interest
});

// Export.image.toDrive({
//   image: DistributionMap2,
//   description: 'PotentialDistribution',
//   scale: GrainSize,
//   maxPixels: 1e10,
//   region: AOI
// });

Export.table.toDrive({
  collection: ee.FeatureCollection(AUCROCs
                        .map(function(element){
                        return ee.Feature(null,{AUCROC:element})})),
  description: 'AUCROC',
  fileFormat: 'CSV',
});

Export.table.toDrive({
  collection: ee.FeatureCollection(AUCPRs
                        .map(function(element){
                        return ee.Feature(null,{AUCPR:element})})),
  description: 'AUCPR',
  fileFormat: 'CSV',
});

Export.table.toDrive({
  collection: ee.FeatureCollection(Metrics),
  description: 'Metrics',
  fileFormat: 'CSV',
});
/*
*/

