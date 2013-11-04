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
define([
  'angular',
  'app',
  'underscore',
  'jquery',
  'kbn',
  'd3'
],
function (angular, app, _, $, kbn, d3) {
  'use strict';

  var module = angular.module('kibana.panels.terms', []);
  app.useModule(module);

  module.controller('terms', function($scope, querySrv, dashboard, filterSrv) {
    $scope.panelMeta = {
      modals : [
        {
          description: "Inspect",
          icon: "icon-info-sign",
          partial: "app/partials/inspector.html",
          show: $scope.panel.spyable
        }
      ],
      editorTabs : [
        {title:'Queries', src:'app/partials/querySelect.html'}
      ],
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
      filterField: null,
      exclude : [],
      include : null,
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
      formatString: "{0}",
      termScript: null,
      valueScript: null,
      alias: "",
      valueAlias: "",
      filterTerm: "",
      filterId: null
    };
    _.defaults($scope.panel,_d);

    $scope.init = function () {
      $scope.hits = 0;

      $scope.$on('refresh',function(){
        $scope.get_data();
      });
      $scope.get_data();

    };

    $scope.getFilterField = function() {
      var termFields = $scope.termFields();
      var result = $scope.panel.filterField != null && $scope.panel.filterField != "" ? $scope.panel.filterField : 
        (termFields.length == 1 ? $scope.panel.field : termFields);
      return result;
    }

    $scope.buildSelectFilter = function() {
      var deleted = $scope.panel.filterId != null ? filterSrv.remove($scope.panel.filterId) : false;
      $scope.panel.filterId = null;
      if ($scope.panel.filterTerm != null && $scope.panel.filterTerm != "") {
        var filterField = $scope.getFilterField();
        var termIsScript = $scope.panel.termScript != null && $scope.panel.termScript != "";

        if (!_.isArray(filterField)) {
          if (termIsScript)
            $scope.panel.filterId = filterSrv.set({type: 'field', field: filterField, query: $scope.panel.filterTerm.toString(), mandate: 'must'});
          else
            $scope.panel.filterId = filterSrv.set({type: 'terms', field: filterField, value: $scope.panel.filterTerm, mandate: 'must'});
        }
        else {
          if (termIsScript)
            $scope.panel.filterId = filterSrv.set({type: 'querystring', query: $scope.buildTermsQuery(filterField, $scope.panel.filterTerm), mandate: 'must'});
          else
            $scope.panel.filterId = filterSrv.set({type:'querystring', query: $scope.buildTermsQuery(filterField, $scope.panel.filterTerm), mandate: 'must'});
        }
      }
      dashboard.refresh();
    }

    $scope.getStatisticLabel = function()
    {
      if ($scope.panel.valueAlias != null && $scope.panel.valueAlias != "") 
        return $scope.panel.valueAlias;
      var mode = $scope.panel.mode;
      return mode.charAt(0).toUpperCase() + mode.slice(1);
    }

    $scope.getFieldLabel = function()
    {
      if ($scope.panel.alias != null && $scope.panel.alias != "") 
        return $scope.panel.alias;
      var field = $scope.panel.field;
      return field.charAt(0).toUpperCase() + field.slice(1);
    }

    //an include expression can have "{filter:filterfield}" in it in which case we replace that {filter:filterfield} with the current value for that term/field filter
    $scope.evaluateIncludeExpression = function(include) {
      if (include == null || include == "") return include;

      var filterMatch = /.*\{filter:([a-zA-Z0-9_]+?)\}/i.exec(include);
      if (filterMatch != null) {
        var result = "";
        var field = filterMatch[1].toString();
      
        var termFilters = filterSrv.getByType("terms");
        _.each(termFilters, function(filter) {
          var filterField = filter.field.toLowerCase();
          if (filterField == field.toLowerCase()) {
            if (result != "") result += "|";
            result += filter.value;
          }
        });

        var fieldFilters = filterSrv.getByType("field");
        _.each(fieldFilters, function(filter) {
          var filterField = filter.field.toLowerCase();
          if (filterField == field.toLowerCase()) {
            if (result != "") result += "|";
            result += filter.query;
          }
        });

        if (result != "") result = "(" + result + ")";
        result = include.replace(new RegExp("\\{filter:" + field + "\\}", "gi"), result);
        return result;
      }

      return include;
    }

    $scope.termFields = function () {
      var result = $scope.panel.field.split(',');
      return result;
    }

    $scope.get_data = function() {
      delete $scope.panel.error;

      // Make sure we have everything for the request to complete
      if(dashboard.indices.length === 0) {
        return;
      }

      $scope.panelMeta.loading = true;

      var request = $scope.ejs.Request().indices(dashboard.indices);

      $scope.panel.queries.ids = querySrv.idsByMode($scope.panel.queries);

      var fq = querySrv.getFacetQuery(filterSrv, $scope.panel.queries, $scope.panel.queries.queryString);
      request = request.query(fq);

      var mode = $scope.panel.mode;

      switch (mode)
      {
        case "count":
          // Terms mode
          var termsFacet = $scope.ejs.TermsFacet('terms')
            .fields($scope.termFields())
            .size($scope.panel.size)
            .order($scope.panel.order);

          if ($scope.panel.exclude != null && _.isArray($scope.panel.exclude) && $scope.panel.exclude.length > 0)
            termsFacet = termsFacet.exclude($scope.panel.exclude);

          if ($scope.panel.include != null && $scope.panel.include != "")
            termsFacet = termsFacet.regex($scope.evaluateIncludeExpression($scope.panel.include));

          if ($scope.panel.termScript != null && $scope.panel.termScript != "")
            termsFacet = termsFacet.scriptField($scope.panel.termScript);

          request = request.facet(termsFacet).size(0);
          break;

        default:
          if ($scope.panel.valueField == "") {
            $scope.panel.error = "Value field must be specified.";
            return;
          }

          var tsFacet = $scope.ejs.TermStatsFacet('terms')
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

      // Populate the inspector panel
      $scope.inspector = angular.toJson(JSON.parse(request.toString()),true);

      var results = request.doSearch();

      // Populate scope when we have results
      results.then(function(results) {
        require(['jquery.number'], function(){
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
            if ($scope.panel.missing)
              $scope.data.push({label:'Missing field',
                data:[[k,results.facets.terms.missing]],meta:"missing",color:'#aaa',opacity:0});
            if ($scope.panel.other)
              $scope.data.push({label:'Other values',
                data:[[k+1,results.facets.terms.other]],meta:"other",color:'#444'});
          }

          $scope.$emit('render');
        });
      });
    };

    $scope.buildTermsQuery = function(fields, value) {
      var result = "";
      _.each(fields, function(field) {
        if (result != "") result += " OR ";
        result += "(" + field + ":\"" + value + "\")";
      });
      return result;
    }

    $scope.build_search = function(term,negate) {
      if (_.isUndefined(negate)) negate = false;
      var filterField = $scope.getFilterField();
      if(_.isUndefined(term.meta)) {
        var termIsScript = $scope.panel.termScript != null && $scope.panel.termScript != "";

        if (!_.isArray(filterField)) {
          if (termIsScript)
            filterSrv.set({type: 'field', field: filterField, query: term.label, mandate: (negate ? 'mustNot':'must')});
          else
            filterSrv.set({type:'terms', field: filterField, value: term.label, mandate: (negate ? 'mustNot':'must')});
        }
        else {
          if (termIsScript)
            filterSrv.set({type: 'querystring', query: $scope.buildTermsQuery(filterField, term.label), mandate: (negate ? 'mustNot':'must')});
          else
            filterSrv.set({type:'querystring', query: $scope.buildTermsQuery(filterField, term.label), mandate: (negate ? 'mustNot':'must')});
        }

      } else if(term.meta === 'missing') {
        filterSrv.set({type:'exists',field:filterField, mandate:(negate ? 'must':'mustNot')});
      } else {
        return;
      }
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

    $scope.formatMetricValue = function(metric) {
      var formatted = $.number(metric, $scope.panel.decimals, $scope.panel.decimalSeparator, $scope.panel.commaSeparator);
      if (!_.isUndefined($scope.panel.formatString) && $scope.panel.formatString != null && $scope.panel.formatString != "")
        formatted = $scope.panel.formatString.replace(/\{0\}/g, formatted);
      return formatted;
    }
  });

  module.directive('termsChart', function(querySrv) {
    return {
      restrict: 'A',
      link: function(scope, elem) {
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

          // IE doesn't work without this
          elem.css({height:scope.panel.height||scope.row.height});

          // Make a clone we can operate on.
          chartData = _.clone(scope.data);
          chartData = scope.panel.missing ? chartData :
            _.without(chartData,_.findWhere(chartData,{meta:'missing'}));
          chartData = scope.panel.other ? chartData :
          _.without(chartData,_.findWhere(chartData,{meta:'other'}));

          // Populate element.
          require(['jquery.flot.pie'], function(){
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
                  return '<div ng-click="build_search(\''+label+'\')'+
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
                //setTimeout(function(){
                  scope.legend = plot.getData();
                //});
              }

              if(!scope.$$phase) {
                scope.$apply();
              }
            } catch(e) {
              elem.text(e);
            }
          });
        }

        elem.bind("plotclick", function (event, pos, object) {
          if(object) {
            scope.build_search(scope.data[object.seriesIndex]);
          }
        });

        var $tooltip = $('<div>');
        elem.bind("plothover", function (event, pos, item) {
          if (item) {
            var value = scope.panel.chart === 'bar' ? item.datapoint[1] : item.datapoint[1][0][1];
            var formatted = scope.formatMetricValue(value);
            $tooltip
              .html(
                kbn.query_color_dot(item.series.color, 20) + ' ' +
                item.series.label + " (" + formatted +")"
              )
              .place_tt(pos.pageX, pos.pageY);
          } else {
            $tooltip.remove();
          }
        });
      }
    };
  });

  module.directive('bubbles', function(querySrv) {
    return {
      restrict: 'A',
      link: function(scope, elem) {
        scope.$on('render',function(){
          render_panel();
        });

        angular.element(window).bind('resize', function(){
          render_panel();
        });

        function getData() {
          var result = _.clone(scope.data);
          result = scope.panel.missing ? result : _.without(result,_.findWhere(result,{meta:'missing'}));
          result = scope.panel.other ? result : _.without(result,_.findWhere(result,{meta:'other'}));
          return result;
        }

        function render_panel() {
          elem.css({height:scope.panel.height||scope.row.height});
          var chartData = getData();
          drawBubbles(elem[0], chartData, elem.width(), elem.height()); 
          if(!scope.$$phase) scope.$apply();
        }

        function drawBubbles(selector, data, width, height) {
          var plot = Bubbles(width, height);
          d3.select(selector)
            .datum(data)
            .call(plot)
        }

        //source: http://vallandingham.me/bubble_cloud/
        function Bubbles(width, height) {
          var width = width;
          var height = height;
          var data = [];
          var node = null;
          var label = null;
          var margin = {top: 5, right: 0, bottom: 0, left: 0};
          var maxRadius = 50;
          var minRadius = 7;
          var rScale = d3.scale.sqrt().range([minRadius,maxRadius]);

          var collisionPadding = 4;
          var minCollisionRadius = 12;

          var jitter = 0.5;

          var idValue = function (d) { return d.label; };
          var textValue = function (d) { return d.label; };
          var rValue = function(d) { return parseFloat(d.data[0][1]); };

          var gravity = function (alpha) {
            var cx = width / 2;
            var cy = height / 2;
            var ax = alpha / 8;
            var ay = alpha;

            return function (d) {
              d.x += (cx - d.x) * ax;
              d.y += (cy - d.y) * ay;
            };
          };

          var collide = function (jitter) {
            return function (d) {
              data.forEach (function (d2) {
                if (d != d2) {
                  var x = d.x - d2.x;
                  var y = d.y - d2.y;
                  var distance = Math.sqrt(x * x + y * y);
                  var minDistance = d.forceR + d2.forceR + collisionPadding;

                  if (distance < minDistance) {
                    distance = (distance - minDistance) / distance * jitter;
                    var moveX = x * distance;
                    var moveY = y * distance;
                    d.x -= moveX;
                    d.y -= moveY;
                    d2.x += moveX;
                    d2.y += moveY;
                  }
                }
              });
            };
          };

          var tick = function (e) {
            var dampenedAlpha = e.alpha * 0.1;
    
            node
              .each(gravity(dampenedAlpha))
              .each(collide(jitter))
              .attr("transform", function (d) { return "translate(" + d.x + "," + d.y + ")"; });

            var offset = elem.position();

            label
              .style("left", function (d) { return (offset.left + (margin.left + d.x) - d.dx / 2) + "px"; })
              .style("top", function (d) { return (offset.top + (margin.top + d.y) - d.dy / 2) + "px"; } );
          }

          var force = d3.layout.force()
            .gravity(0)
            .charge(0)
            .size([width, height])
            .on("tick", tick)

          var transformData = function(rawData) {
            rawData.forEach(function(d) {
              rawData.sort(function() { return 0.5 - Math.random(); });
            });
            return rawData;
          }

          var clear = function () { window.location.replace("#"); };

          var update = function() {
            data.forEach (function (d,i) {
              d.forceR = Math.max(minCollisionRadius, rScale(rValue(d))); 
            });

            force.nodes(data).start();

            updateNodes();
            updateLabels();
          }

          var updateLabels = function () {
            label = label.selectAll(".bubble-label").data(data, function (d) { return idValue(d); });

            label.exit().remove();

            var labelEnter = label.enter().append("a")
              .attr("class", "bubble-label")
              .attr("href", function (d) { return "#" + encodeURIComponent(idValue(d)); })
              .call(force.drag)
              .call(connectEvents);

            labelEnter.append("div")
              .attr("class", "bubble-label-name")
              .text(function (d) { return textValue(d); });

            labelEnter.append("div")
              .attr("class", "bubble-label-value")
              .text(function (d) { 
                var value = rValue(d); 
                var formatted = scope.formatMetricValue(value);
                return value >= 5 ? formatted : ""; 
              });

            label
              .style("font-size", function (d) { return Math.max(8, rScale(rValue(d) / 8)) + "px"; })
              .style("width", function (d) { return 2.5 * rScale(rValue(d)) + "px"; });

            label.append("span")
              .text(function (d) { return textValue(d); })
              .each(function (d) { d.dx = Math.max(2.5 * rScale(rValue(d)), this.getBoundingClientRect().width); })
              .remove();

            label
              .style("width", function (d) { return d.dx + "px"; });
  
            label.each(function (d) { d.dy = this.getBoundingClientRect().height; });
          }

          var updateNodes = function () {
            node = node.selectAll(".bubble-node").data(data, function(d) { return idValue(d); });

            node.exit().remove();

            node.enter()
              .append("a")
              .attr("class", "bubble-node")
              .attr("xlink:href", function (d) { return "#" + encodeURIComponent(idValue(d)); })
              .call(force.drag)
              .call(connectEvents)
              .append("circle")
              .attr("r", function (d) { return rScale(rValue(d)); })
              .attr("fill", function(d, i) { return querySrv.colorAt(i); })
              .attr("stroke", function(d, i) { return querySrv.colorAt(i); })
              .attr("stroke-width", 1);
          }

          var connectEvents = function (d) {
            d.on("click", click);
            d.on("mouseover", mouseover);
            d.on("mouseout", mouseout);
          }

          var click = function (d) {
            scope.build_search(d);
            d3.event.preventDefault();
          }

          var mouseover = function (d) {
            node.classed("bubble-hover", function (p) { return p == d; });
          }

          var mouseout = function (d) {
            node.classed("bubble-hover", false);
          }

          var reset = function (data) {
            var self = elem[0];
            d3.select(self).selectAll("svg").remove();
            d3.select(self).selectAll("#bubble-labels").remove();
            data.forEach (function (d) {
              delete d.x;
              delete d.dx;
              delete d.y;
              delete d.dy;
              delete d.forceR;
              delete d.index;
              delete d.weight;
              delete d.px;
              delete d.py;
            });
          }

          function chart(selection) {
            selection.each(function(rawData) {
              data = transformData(rawData)

              reset(data);

              var maxDomainValue = d3.max(data, function(d) { return rValue(d); });
              rScale.domain([0, maxDomainValue]);

              var svg = d3.select(this).selectAll("svg").data([data]);
              var svgEnter = svg.enter().append("svg");
              svg.attr("width", width + margin.left + margin.right );
              svg.attr("height", height + margin.top + margin.bottom );
      
              node = svgEnter.append("g").attr("id", "bubble-nodes")
                .attr("transform", "translate(" + margin.left + "," + margin.top + ")");

              node.append("rect")
                .attr("id", "bubble-background")
                .attr("width", width)
                .attr("height", height)
                .on("click", clear);

              label = d3.select(this).selectAll("#bubble-labels").data([data])
                .enter()
                .append("div")
                .attr("id", "bubble-labels");

              update();
            });
          }

          return chart;
        }

      }
    };
  });

});