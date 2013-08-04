/*jshint globalstrict:true */
/*global angular:true */

/*

  ## Terms

  ### Parameters
  * style :: A hash of css styles
  * size :: top N
  * arrangement :: How should I arrange the query results? 'horizontal' or 'vertical'
  * chart :: Show a chart? 'none', 'bar', 'pie'
  * donut :: Only applies to 'pie' charts. Punches a hole in the chart for some reason
  * tilt :: Only 'pie' charts. Janky 3D effect. Looks terrible 90% of the time. 
  * lables :: Only 'pie' charts. Labels on the pie?

*/

'use strict';

angular.module('kibana.terms', [])
.controller('terms', function($scope, querySrv, dashboard, filterSrv) {

  $scope.panelMeta = {
    status  : "Beta",
    description : "Displays the results of an elasticsearch facet as a pie chart, bar chart, or a "+ 
      "table"
  };

  // Set and populate defaults
  var _d = {
    queries     : {
      mode        : 'all',
      ids         : []
    },
    field   : '_type',
    exclude : [],
    missing : true,
    other   : true,
    size    : 10,
    order   : 'count',
    style   : { "font-size": '10pt'},
    donut   : false,
    tilt    : false,
    labels  : true,
    arrangement : 'horizontal',
    chart       : 'bar',
    counter_pos : 'above',
    spyable     : true,
    mode: "count",
    valueField: "",
    decimals: 0,
    decimalSeparator: ".",
    commaSeparator: ",",
    formatString: "{0}"
  };
  _.defaults($scope.panel,_d);

  $scope.init = function () {
    $scope.hits = 0;
   
    $scope.$on('refresh',function(){
      $scope.get_data();
    });
    $scope.get_data();

  };

  $scope.getStatisticLabel = function()
  {
    var mode = $scope.panel.mode;
    return mode.charAt(0).toUpperCase() + mode.slice(1)
  }

  $scope.get_data = function(segment,query_id) {
    delete $scope.panel.error;

    // Make sure we have everything for the request to complete
    if(dashboard.indices.length === 0) {
      return;
    } 

    $scope.panelMeta.loading = true;

    var request = $scope.ejs.Request().indices(dashboard.indices);

    $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

    var facetFilter = querySrv.getFacetFilter(filterSrv, $scope.panel.queries, $scope.panel.queries.queryString);

    var mode = $scope.panel.mode;

    switch (mode)
    {
      case "count":
        // Terms mode
        request = request
         .facet($scope.ejs.TermsFacet('terms')
          .field($scope.panel.field)
          .size($scope.panel.size)
          .order($scope.panel.order)
          .exclude($scope.panel.exclude)
          .facetFilter(facetFilter)).size(0);
        break;

      default:
        if ($scope.panel.valueField == "") {
          $scope.panel.error = "Value field must be specified.";
          return;
        }
      
        request = request
         .facet($scope.ejs.TermStatsFacet('terms')
          .keyField($scope.panel.field)
          .valueField($scope.panel.valueField)
          .size($scope.panel.size)
          .order($scope.panel.order)
          .facetFilter(facetFilter)).size(0);
        break;
    }

    // Populate the inspector panel
    $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

    var results = request.doSearch();

    // Populate scope when we have results
    results.then(function(results) {
      var scripts = $LAB.script("common/lib/jquery.number.min.js");
            
      scripts.wait(function() {
        var k = 0;
        var valueField = mode;

        $scope.panelMeta.loading = false;
        $scope.hits = results.hits.total;
        $scope.data = [];

        _.each(results.facets.terms.terms, function(v) {
          var decimals = !_.isUndefined($scope.panel.decimals) ? $scope.panel.decimals : 0;
          var value = mode == "count" ? v[valueField] : parseFloat($.number(v[valueField], decimals, ".", ""));
          var slice = { label : v.term, data : [[k,value]], actions: true}; 
          $scope.data.push(slice);
          k = k + 1;
        });

        if (mode == "count") {
          $scope.data.push({label:'Missing field',
            data:[[k,results.facets.terms.missing]],meta:"missing",color:'#aaa',opacity:0});
          $scope.data.push({label:'Other values',
            data:[[k+1,results.facets.terms.other]],meta:"other",color:'#444'});
        }

        $scope.$emit('render');
      });
    });
  };

  $scope.build_search = function(term,negate) {
    if(_.isUndefined(term.meta)) {
      filterSrv.set({type:'terms',field:$scope.panel.field,value:term.label,
        mandate:(negate ? 'mustNot':'must')});
    } else if(term.meta === 'missing') {
      filterSrv.set({type:'exists',field:$scope.panel.field,
        mandate:(negate ? 'must':'mustNot')});
    } else {
      return;
    }
    dashboard.refresh();
  };

  $scope.set_refresh = function (state) { 
    $scope.refresh = state; 
  };

  $scope.close_edit = function() {
    if($scope.refresh) {
      $scope.get_data();
    }
    $scope.refresh =  false;
    $scope.$emit('render');
  };

  $scope.showMeta = function(term) {
    if(_.isUndefined(term.meta)) {
      return true;
    }
    if(term.meta === 'other' && !$scope.panel.other) {
      return false;
    }
    if(term.meta === 'missing' && !$scope.panel.missing) {
      return false;
    }
    return true;
  };

  $scope.formatMetricLabel = function(metric) {
    var formatted = $.number(metric, $scope.panel.decimals, $scope.panel.decimalSeparator, $scope.panel.commaSeparator);
    if (!_.isUndefined($scope.panel.formatString) && $scope.panel.formatString != "")
      formatted = $scope.panel.formatString.replace(/\{0\}/g, formatted);
    return formatted;
  }

}).directive('termsChart', function(querySrv, filterSrv, dashboard) {
  return {
    restrict: 'A',
    link: function(scope, elem, attrs, ctrl) {

      // Receive render events
      scope.$on('render',function(){
        render_panel();
      });
  
      // Re-render if the window is resized
      angular.element(window).bind('resize', function(){
        render_panel();
      });

      // Function for rendering panel
      function render_panel() {
        var plot, chartData;
        var scripts = $LAB.script("common/lib/panels/jquery.flot.js").wait()
                          .script("common/lib/panels/jquery.flot.pie.js");

        // IE doesn't work without this
        elem.css({height:scope.panel.height||scope.row.height});

        // Make a clone we can operate on.
        chartData = _.clone(scope.data);
        chartData = scope.panel.missing ? chartData : 
          _.without(chartData,_.findWhere(chartData,{meta:'missing'}));
        chartData = scope.panel.other ? chartData : 
        _.without(chartData,_.findWhere(chartData,{meta:'other'}));

        // Populate element.
        scripts.wait(function(){
          // Populate element
          try {
            // Add plot to scope so we can build out own legend 
            if(scope.panel.chart === 'bar') {
              plot = $.plot(elem, chartData, {
                legend: { show: false },
                series: {
                  lines:  { show: false, },
                  bars:   { show: true,  fill: 1, barWidth: 0.8, horizontal: false },
                  shadowSize: 1
                },
                yaxis: { show: true, min: 0, color: "#c8c8c8" },
                xaxis: { show: false },
                grid: {
                  borderWidth: 0,
                  borderColor: '#eee',
                  color: "#eee",
                  hoverable: true,
                  clickable: true
                },
                colors: querySrv.colors
              });
            }
            if(scope.panel.chart === 'pie') {
              var labelFormat = function(label, series){
                return '<div ng-click="build_search(panel.field,\''+label+'\')'+
                  ' "style="font-size:8pt;text-align:center;padding:2px;color:white;">'+
                  label+'<br/>'+Math.round(series.percent)+'%</div>';
              };

              plot = $.plot(elem, chartData, {
                legend: { show: false },
                series: {
                  pie: {
                    innerRadius: scope.panel.donut ? 0.4 : 0,
                    tilt: scope.panel.tilt ? 0.45 : 1,
                    radius: 1,
                    show: true,
                    combine: {
                      color: '#999',
                      label: 'The Rest'
                    },
                    stroke: {
                      width: 0
                    },
                    label: { 
                      show: scope.panel.labels,
                      radius: 2/3,
                      formatter: labelFormat,
                      threshold: 0.1 
                    }
                  }
                },
                //grid: { hoverable: true, clickable: true },
                grid:   { hoverable: true, clickable: true },
                colors: querySrv.colors
              });
            }

            // Populate legend
            if(elem.is(":visible")){
              scripts.wait(function(){
                scope.legend = plot.getData();
                if(!scope.$$phase) {
                  scope.$apply();
                }
              });
            }

          } catch(e) {
            elem.text(e);
          }
        });
      }

      function tt(x, y, contents) {
        var tooltip = $('#pie-tooltip').length ? 
          $('#pie-tooltip') : $('<div id="pie-tooltip"></div>');
        //var tooltip = $('#pie-tooltip')
        tooltip.html(contents).css({
          position: 'absolute',
          top     : y + 5,
          left    : x + 5,
          color   : "#c8c8c8",
          padding : '10px',
          'font-size': '11pt',
          'font-weight' : 200,
          'background-color': '#1f1f1f',
          'border-radius': '5px',
        }).appendTo("body");
      }

      elem.bind("plotclick", function (event, pos, object) {
        if(object) {
          scope.build_search(scope.data[object.seriesIndex]);
        }
      });

      elem.bind("plothover", function (event, pos, item) {
        if (item) {
          var value = scope.panel.chart === 'bar' ? 
            item.datapoint[1] : item.datapoint[1][0][1];

          var formatted = scope.formatMetricLabel(value);

          tt(pos.pageX, pos.pageY,
            "<div style='vertical-align:middle;border-radius:10px;display:inline-block;background:"+
            item.series.color+";height:20px;width:20px'></div> "+item.series.label+
            " ("+formatted+")");
        } else {
          $("#pie-tooltip").remove();
        }
      });

    }
  };
});
