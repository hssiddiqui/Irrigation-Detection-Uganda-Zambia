// Interactive EVI Extraction
// Adapted from https://developers.google.com/earth-engine/tutorials/community/drawing-tools-region-reduction
// Original app by: Justin Braaten
// Adapted code by: Hasan Siddiqui and Shruti Jain

// VARIABLES TO CHANGE
var country = 'Zambia'
var drySeasonStart = '2023-08-01'
var drySeasonEnd = '2023-08-30'


var S2Tiles = ee.FeatureCollection("FAO/GAUL/2015/level0")
              .filter(ee.Filter.eq('ADM0_NAME',country));

  
//CUSTOM DRAWING TOOLS
var drawingTools = Map.drawingTools();
drawingTools.setShown(false);


//EVENT CALLBACK FUNCTIONS
function clearGeometry() {
  while (drawingTools.layers().length() > 0) {
    var layer = drawingTools.layers().get(0);
    drawingTools.layers().remove(layer);
  }
  
  var dummyGeometry =
      ui.Map.GeometryLayer({geometries: null, name: 'geometry', color: '23cba7'});
      
  drawingTools.layers().add(dummyGeometry);
}

clearGeometry();

function drawRectangle() {
  clearGeometry();
  drawingTools.setShape('rectangle');
  drawingTools.draw();
}

function drawPolygon() {
  clearGeometry();
  drawingTools.setShape('polygon');
  drawingTools.draw();
}

function drawPoint() {
  clearGeometry();
  drawingTools.setShape('point');
  drawingTools.draw();
}

var chartPanel = ui.Panel({
  style:
      {height: '235px', width: '600px', position: 'bottom-right', shown: false}
});

Map.add(chartPanel);

// Cloud masking
function maskCloudAndShadows(image) {
  var cloudProb = image.select('MSK_CLDPRB');
  var snowProb = image.select('MSK_SNWPRB');
  var cloud = cloudProb.lt(5);
  var snow = snowProb.lt(5);
  var scl = image.select('SCL'); 
  var shadow = scl.eq(3); // 3 = cloud shadow
  var cirrus = scl.eq(10); // 10 = cirrus
  // Cloud probability less than 5% or cloud shadow classification
  var mask = (cloud.and(snow)).and(cirrus.neq(1)).and(shadow.neq(1));
  return image.updateMask(mask);
}

// Adding a EVI band
function addEVI(image) {
  var evi = image.expression(
    '(2.5*(NIR-RED)) / (NIR+6*RED-7.5*BLUE+1)', {
      'NIR': image.select('B8').multiply(0.0001),
      'RED': image.select('B4').multiply(0.0001),
      'BLUE': image.select('B2').multiply(0.0001),
    }).rename('evi')
  return image.addBands([evi])
}

var startDate = '2022-01-01'
var endDate = '2024-07-30'


function chartEVITimeSeries() {
  if (!chartPanel.style().get('shown')) {
    chartPanel.style().set('shown', true);
  }
  // Get the drawn geometry; it will define the reduction region.
  var aoi = drawingTools.layers().get(0).getEeObject();
  // Use Sentinel-2 L2A data - which has better cloud masking
  var collection = ee.ImageCollection('COPERNICUS/S2_SR')
      .filterDate(startDate, endDate)
      .map(maskCloudAndShadows)
      .map(addEVI)
      .filter(ee.Filter.bounds(aoi))
      
  aoi = ee.FeatureCollection(aoi.geometries().map(function(p){
    return ee.Feature(ee.Geometry(p), {})
  }))

  var getImage = function(id) {
    return ee.Image(collection.filter(ee.Filter.eq('system:index', id)).first())
  }
  // Set the drawing mode back to null; turns drawing off.
  drawingTools.setShape(null);

  // Reduction scale is based on map scale to avoid memory/timeout errors.
  var mapScale = Map.getScale();
  var scale = mapScale > 5000 ? mapScale * 2 : 5000;
  // Make the chart panel visible the first time a geometry is drawn.

  // Chart NDVI time series for the selected area of interest.
  var chart = ui.Chart.image.seriesByRegion({
    imageCollection: collection.select('evi'),
    regions: aoi,
    reducer: ee.Reducer.mean()
    }).setOptions({
      interpolateNulls: true,
      lineWidth: 1,
      pointSize: 3,
      title: 'EVI over time at aoi',
      vAxis: {title: 'EVI', viewWindow: {min: 0, max: 1}},
      hAxis: {title: 'Date', format: 'YYYY-MMM', gridlines: {count: 24}},


    });
  // Replace the existing chart in the chart panel with the new chart.
  chartPanel.widgets().reset([chart]);
  
  var polyFeature = ee.FeatureCollection(aoi);
  Export.table.toDrive({
    collection: polyFeature,
    description: 'Zambia_irrig_EVI_Extraction_save_aoi',
    folder: 'earthengine_BF',
    fileNamePrefix: 'polys_Zambia_irrig_',
    fileFormat: 'geojson'
  })
}

//USER INTERFACE
var symbol = {
  rectangle: '⬛',
  polygon: '🔺',
  point: '📍',
};

var controlPanel = ui.Panel({
  widgets: [
    ui.Label('1. Select a drawing mode.'),
    ui.Button({
      label: symbol.rectangle + ' Rectangle',
      onClick: drawRectangle,
      style: {stretch: 'horizontal'}
    }),
    ui.Button({
      label: symbol.polygon + ' Polygon',
      onClick: drawPolygon,
      style: {stretch: 'horizontal'}
    }),
    ui.Button({
      label: symbol.point + ' Point',
      onClick: drawPoint,
      style: {stretch: 'horizontal'}
    }),
    ui.Label(
      '2. Draw geometry.\nGet timeseries when done.',
      {whiteSpace: 'pre'}),
    ui.Button({
      label: 'Get timeseries',
      onClick: ui.util.debounce(chartEVITimeSeries, 500),
      style: {stretch: 'horizontal'}
    }),
    ui.Label('3. Wait for chart to render.'),
    ui.Label(
        '4. Repeat 1-3 or edit/move\ngeometry for a new chart.',
        {whiteSpace: 'pre'})
  ],
  style: {position: 'bottom-left'},
  layout: null,
});

Map.add(controlPanel);





function maskS2clouds(image) {
  var qa = image.select('QA60');

  // Bits 10 and 11 are clouds and cirrus, respectively.
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;

  // Both flags should be set to zero, indicating clear conditions.
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
      .and(qa.bitwiseAnd(cirrusBitMask).eq(0));

  return image.updateMask(mask).divide(10000);
}


var dataset = ee.ImageCollection('COPERNICUS/S2_SR')
                  .filterDate(drySeasonStart, drySeasonEnd)
                  // Pre-filter to get less cloudy granules.
                  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE',20))
                  .filterBounds(S2Tiles)
                  .map(maskS2clouds);

var visualization = {
  min: [0,0,0],
  max: [0.35,0.5,0.25],
  bands: ['B12', 'B8', 'B4'],
};

// Map.centerObject(S2Tiles,8);

Map.addLayer(dataset.median().clip(S2Tiles), visualization, 'Sentinel-2 swir2 nir blue');
