/*

  ## Map

  ### Parameters
  * map :: 'world', 'us' or 'europe'
  * colors :: an array of colors to use for the regions of the map. If this is a 2
              element array, jquerymap will generate shades between these colors
  * size :: How big to make the facet. Higher = more countries
  * exclude :: Exlude the array of counties
  * spyable :: Show the 'eye' icon that reveals the last ES query
  * index_limit :: This does nothing yet. Eventually will limit the query to the first
                   N indices

*/

define([
  'angular',
  'app',
  'underscore',
  'jquery',
  'config',
  './lib/jquery.jvectormap.min'
],
function (angular, app, _, $) {
  'use strict';

  var module = angular.module('kibana.panels.map', []);
  app.useModule(module);

  module.controller('map', function($scope, $rootScope, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      status  : "Stable",
      description : "Displays a map of shaded regions using a field containing a 2 letter country "+
       ", or US state, code. Regions with more hit are shaded darker. Node that this does use the"+
       " Elasticsearch terms facet, so it is important that you set it to the correct field."
    };

    // Set and populate defaults
    var _d = {
      queries     : {
        mode        : 'all',
        ids         : []
      },
      map     : "world",
      colors  : ['#A0E2E2', '#265656'],
      size    : 100,
      exclude : [],
      spyable : true,
      index_limit : 0,
      order   : 'count',
      mode    : "count",
      valueField: "",
      valueScript: "",
      decimals: 0,
      decimalSeparator: ".",
      commaSeparator: ",",
      formatString: "{0}"
    };
    _.defaults($scope.panel,_d);

    $scope.init = function() {
      $scope.$on('refresh',function(){$scope.get_data();});
      $scope.get_data();
    };

    $scope.set_refresh = function (state) {
      $scope.refresh = state;
    };

    $scope.close_edit = function() {
      if ($scope.refresh) $scope.get_data();
      $scope.refresh = false;
    };

    $scope.get_data = function() {
      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) return;

      var request = $scope.ejs.Request().indices(dashboard.indices);

      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

      var fq = querySrv.getFacetQuery(filterSrv, $scope.panel.queries, $scope.panel.queries.queryString);
      request = request.query(fq);

      var mode = $scope.panel.mode;

      switch (mode)
      {
        case "count":
          // Terms mode
          var termsFacet = $scope.ejs.TermsFacet('map')
            .field($scope.panel.field)
            .size($scope.panel.size)
            .order($scope.panel.order);

          if ($scope.panel.exclude != null && _.isArray($scope.panel.exclude) && $scope.panel.exclude.length > 0)
            termsFacet = termsFacet.exclude($scope.panel.exclude);

          request = request.facet(termsFacet).size(0);
          break;

        default:
          if ($scope.panel.valueField == "") {
            $scope.panel.error = "Value field must be specified.";
            return;
          }

          var tsFacet = $scope.ejs.TermStatsFacet('map')
            .keyField($scope.panel.field)
            .size($scope.panel.size)
            .order($scope.panel.order)
            ;

          if ($scope.panel.valueScript != null && $scope.panel.valueScript != "")
            tsFacet = tsFacet.valueScript($scope.panel.valueScript);
          else
            tsFacet = tsFacet.valueField($scope.panel.valueField);
      
          request = request.facet(tsFacet).size(0);
          break;
      }

      $scope.populate_modal(request);

      $scope.panelMeta.loading = true;

      var results = request.doSearch();

      // Populate scope when we have results
      results.then(function(results) {
        require(['jquery.number'], function(){
          $scope.panelMeta.loading = false;
          $scope.hits = results.hits.total;
          $scope.data = {};
          
          var valueField = mode;
          _.each(results.facets.map.terms, function(v) {
            var decimals = !_.isUndefined($scope.panel.decimals) ? $scope.panel.decimals : 0;
            var value = mode == "count" ? v[valueField] : parseFloat($.number(v[valueField], decimals, ".", ""));
            $scope.data[v.term.toUpperCase()] = value;
          });

          $scope.$emit('render');
        });
      });
    };

    // I really don't like this function, too much dom manip. Break out into directive?
    $scope.populate_modal = function(request) {
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);
    };

    $scope.build_search = function(field,value) {
      filterSrv.set({type:'querystring',mandate:'must',query:field+":"+value});
    };

    $scope.formatMetricValue = function(metric) {
      var formatted = $.number(metric, $scope.panel.decimals, $scope.panel.decimalSeparator, $scope.panel.commaSeparator);
      if (!_.isUndefined($scope.panel.formatString) && $scope.panel.formatString != null && $scope.panel.formatString != "")
        formatted = $scope.panel.formatString.replace(/\{0\}/g, formatted);
      return formatted;
    }
  });


  module.directive('map', function() {
    return {
      restrict: 'A',
      link: function(scope, elem) {

        elem.html('<center><img src="img/load_big.gif"></center>');

        // Receive render events
        scope.$on('render',function(){
          render_panel();
        });

        // Or if the window is resized
        angular.element(window).bind('resize', function(){
          render_panel();
        });

        function render_panel() {
          elem.text('');
          $('.jvectormap-zoomin,.jvectormap-zoomout,.jvectormap-label').remove();
          require(['./panels/map/lib/map.'+scope.panel.map], function () {
            elem.vectorMap({
              map: scope.panel.map,
              regionStyle: {initial: {fill: '#8c8c8c'}},
              zoomOnScroll: false,
              backgroundColor: null,
              series: {
                regions: [{
                  values: scope.data,
                  scale: scope.panel.colors,
                  normalizeFunction: 'polynomial'
                }]
              },
              onRegionLabelShow: function(event, label, code){
                elem.children('.map-legend').show();
                var value = _.isUndefined(scope.data[code]) ? 0 : scope.data[code];
                var formatted = scope.formatMetricValue(value);
                elem.children('.map-legend').text(label.text() + ": " + formatted);
              },
              onRegionOut: function() {
                $('.map-legend').hide();
              },
              onRegionClick: function(event, code) {
                var count = _.isUndefined(scope.data[code]) ? 0 : scope.data[code];
                if (count !== 0) {
                  scope.build_search(scope.panel.field,code);
                }
              }
            });
            elem.prepend('<span class="map-legend"></span>');
            $('.map-legend').hide();
          });

          if(!scope.$$phase) scope.$apply();
        }
      }
    };
  });
});